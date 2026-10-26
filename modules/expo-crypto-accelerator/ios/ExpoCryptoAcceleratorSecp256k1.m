#import "ExpoCryptoAcceleratorSecp256k1.h"

#import <Security/Security.h>
#import <secp256k1.h>
#import <secp256k1_extrakeys.h>
#import <secp256k1_schnorrsig.h>

static secp256k1_context *ExpoCryptoAcceleratorContext(void) {
  static secp256k1_context *context = NULL;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    context = secp256k1_context_create(SECP256K1_CONTEXT_SIGN | SECP256K1_CONTEXT_VERIFY);
    uint8_t seed[32];
    if (SecRandomCopyBytes(kSecRandomDefault, sizeof(seed), seed) != errSecSuccess || !secp256k1_context_randomize(context, seed)) {
      secp256k1_context_destroy(context); context = NULL;
    }
    memset_s(seed, sizeof(seed), 0, sizeof(seed));
  });
  return context;
}

BOOL ExpoCryptoAcceleratorDeriveSharedX(const uint8_t privkey[32], const uint8_t pubkey[32], uint8_t output[32]) {
  secp256k1_context *context = ExpoCryptoAcceleratorContext();
  if (context == NULL) {
    return NO;
  }

  uint8_t compressedPubkey[33] = {0};
  compressedPubkey[0] = 0x02;
  memcpy(compressedPubkey + 1, pubkey, 32);

  secp256k1_pubkey parsedPubkey;
  if (secp256k1_ec_pubkey_parse(context, &parsedPubkey, compressedPubkey, sizeof(compressedPubkey)) != 1) {
    return NO;
  }

  if (secp256k1_ec_pubkey_tweak_mul(context, &parsedPubkey, privkey) != 1) {
    return NO;
  }

  uint8_t sharedPubkey[33] = {0};
  size_t sharedPubkeySize = sizeof(sharedPubkey);
  if (secp256k1_ec_pubkey_serialize(
        context,
        sharedPubkey,
        &sharedPubkeySize,
        &parsedPubkey,
        SECP256K1_EC_COMPRESSED
      ) != 1 || sharedPubkeySize != sizeof(sharedPubkey)) {
    return NO;
  }

  memcpy(output, sharedPubkey + 1, 32);
  return YES;
}

BOOL ExpoCryptoAcceleratorVerifySchnorr(const uint8_t signature[64], const uint8_t message[32], const uint8_t pubkey[32]) {
  secp256k1_context *context = ExpoCryptoAcceleratorContext();
  if (context == NULL) {
    return NO;
  }

  secp256k1_xonly_pubkey parsedPubkey;
  if (secp256k1_xonly_pubkey_parse(context, &parsedPubkey, pubkey) != 1) {
    return NO;
  }

  return secp256k1_schnorrsig_verify(context, signature, message, 32, &parsedPubkey) == 1 ? YES : NO;
}

BOOL PsstVaultPublicKey(const uint8_t secret[32], uint8_t output[32]) {
  secp256k1_keypair pair;
  secp256k1_xonly_pubkey pubkey;
  secp256k1_context *context = ExpoCryptoAcceleratorContext();
  if (context == NULL || !secp256k1_keypair_create(context, &pair, secret)) return NO;
  BOOL ok = secp256k1_keypair_xonly_pub(context, &pubkey, NULL, &pair) && secp256k1_xonly_pubkey_serialize(context, output, &pubkey);
  memset_s(&pair, sizeof(pair), 0, sizeof(pair));
  return ok;
}

BOOL PsstVaultSign(const uint8_t secret[32], const uint8_t digest[32], const uint8_t auxiliary[32], uint8_t output[64]) {
  secp256k1_keypair pair;
  secp256k1_context *context = ExpoCryptoAcceleratorContext();
  if (context == NULL || !secp256k1_keypair_create(context, &pair, secret)) return NO;
  BOOL ok = secp256k1_schnorrsig_sign32(context, output, digest, &pair, auxiliary);
  memset_s(&pair, sizeof(pair), 0, sizeof(pair));
  return ok;
}
