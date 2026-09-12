#include <jni.h>
#include <secp256k1.h>
#include <secp256k1_extrakeys.h>
#include <secp256k1_schnorrsig.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdlib>
#include <mutex>
#include <string>

namespace {

constexpr size_t kPrivkeySize = 32;
constexpr size_t kXOnlyPubkeySize = 32;
constexpr size_t kCompressedPubkeySize = 33;
constexpr size_t kSchnorrSignatureSize = 64;

std::once_flag context_once;
secp256k1_context* secp_context = nullptr;

void throw_illegal_argument(JNIEnv* env, const char* message) {
  jclass klass = env->FindClass("java/lang/IllegalArgumentException");
  if (klass != nullptr) env->ThrowNew(klass, message);
}

void throw_runtime_exception(JNIEnv* env, const char* message) {
  jclass klass = env->FindClass("java/lang/RuntimeException");
  if (klass != nullptr) env->ThrowNew(klass, message);
}

int hex_value(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

bool parse_hex_32(const std::string& hex, std::array<unsigned char, 32>& out) {
  if (hex.size() != out.size() * 2) return false;
  for (size_t i = 0; i < out.size(); ++i) {
    const int hi = hex_value(hex[i * 2]);
    const int lo = hex_value(hex[i * 2 + 1]);
    if (hi < 0 || lo < 0) return false;
    out[i] = static_cast<unsigned char>((hi << 4) | lo);
  }
  return true;
}

bool parse_hex_64(const std::string& hex, std::array<unsigned char, 64>& out) {
  if (hex.size() != out.size() * 2) return false;
  for (size_t i = 0; i < out.size(); ++i) {
    const int hi = hex_value(hex[i * 2]);
    const int lo = hex_value(hex[i * 2 + 1]);
    if (hi < 0 || lo < 0) return false;
    out[i] = static_cast<unsigned char>((hi << 4) | lo);
  }
  return true;
}

std::string to_string(JNIEnv* env, jstring value) {
  const char* chars = env->GetStringUTFChars(value, nullptr);
  if (chars == nullptr) return {};
  std::string result(chars);
  env->ReleaseStringUTFChars(value, chars);
  return result;
}

secp256k1_context* get_context() {
  std::call_once(context_once, [] {
    secp_context = secp256k1_context_create(SECP256K1_CONTEXT_VERIFY);
  });
  return secp_context;
}

} // namespace

extern "C" JNIEXPORT jbyteArray JNICALL
Java_chat_psstpsst_app_cryptoaccelerator_ExpoCryptoAcceleratorModule_deriveSharedXNative(
    JNIEnv* env,
    jobject /* this */,
    jstring privkey_hex,
    jstring pubkey_hex) {
  if (privkey_hex == nullptr || pubkey_hex == nullptr) {
    throw_illegal_argument(env, "Expected non-null hex keys.");
    return nullptr;
  }

  std::array<unsigned char, kPrivkeySize> privkey{};
  std::array<unsigned char, kXOnlyPubkeySize> xonly_pubkey{};
  if (!parse_hex_32(to_string(env, privkey_hex), privkey) ||
      !parse_hex_32(to_string(env, pubkey_hex), xonly_pubkey)) {
    throw_illegal_argument(env, "Expected 32-byte hex keys.");
    return nullptr;
  }

  secp256k1_context* ctx = get_context();
  if (ctx == nullptr) {
    throw_runtime_exception(env, "Failed to initialize secp256k1.");
    return nullptr;
  }

  std::array<unsigned char, kCompressedPubkeySize> compressed_pubkey{};
  compressed_pubkey[0] = 0x02;
  std::copy(xonly_pubkey.begin(), xonly_pubkey.end(), compressed_pubkey.begin() + 1);

  secp256k1_pubkey pubkey;
  if (secp256k1_ec_pubkey_parse(
          ctx,
          &pubkey,
          compressed_pubkey.data(),
          compressed_pubkey.size()) != 1) {
    throw_illegal_argument(env, "Invalid secp256k1 public key.");
    return nullptr;
  }

  if (secp256k1_ec_pubkey_tweak_mul(ctx, &pubkey, privkey.data()) != 1) {
    throw_illegal_argument(env, "Invalid secp256k1 private key.");
    return nullptr;
  }

  std::array<unsigned char, kCompressedPubkeySize> shared_pubkey{};
  size_t shared_pubkey_size = shared_pubkey.size();
  if (secp256k1_ec_pubkey_serialize(
          ctx,
          shared_pubkey.data(),
          &shared_pubkey_size,
          &pubkey,
          SECP256K1_EC_COMPRESSED) != 1 ||
      shared_pubkey_size != shared_pubkey.size()) {
    throw_runtime_exception(env, "Failed to serialize secp256k1 shared point.");
    return nullptr;
  }

  jbyteArray result = env->NewByteArray(kXOnlyPubkeySize);
  if (result == nullptr) return nullptr;
  env->SetByteArrayRegion(
      result,
      0,
      kXOnlyPubkeySize,
      reinterpret_cast<const jbyte*>(shared_pubkey.data() + 1));
  return result;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_chat_psstpsst_app_cryptoaccelerator_ExpoCryptoAcceleratorModule_verifySchnorrNative(
    JNIEnv* env,
    jobject /* this */,
    jstring signature_hex,
    jstring message_hex,
    jstring pubkey_hex) {
  if (signature_hex == nullptr || message_hex == nullptr || pubkey_hex == nullptr) {
    return JNI_FALSE;
  }

  std::array<unsigned char, kSchnorrSignatureSize> signature{};
  std::array<unsigned char, kXOnlyPubkeySize> message{};
  std::array<unsigned char, kXOnlyPubkeySize> pubkey_bytes{};
  if (!parse_hex_64(to_string(env, signature_hex), signature) ||
      !parse_hex_32(to_string(env, message_hex), message) ||
      !parse_hex_32(to_string(env, pubkey_hex), pubkey_bytes)) {
    return JNI_FALSE;
  }

  secp256k1_context* ctx = get_context();
  if (ctx == nullptr) {
    return JNI_FALSE;
  }

  secp256k1_xonly_pubkey pubkey;
  if (secp256k1_xonly_pubkey_parse(ctx, &pubkey, pubkey_bytes.data()) != 1) {
    return JNI_FALSE;
  }

  return secp256k1_schnorrsig_verify(
             ctx,
             signature.data(),
             message.data(),
             message.size(),
             &pubkey) == 1
           ? JNI_TRUE
           : JNI_FALSE;
}
