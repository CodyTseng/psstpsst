#include <jni.h>

#include "psst_noise.h"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

static void throw_noise_error(JNIEnv *env, int error) {
  jclass type = (*env)->FindClass(env, "java/lang/IllegalStateException");
  if (type) (*env)->ThrowNew(env, type, psst_noise_error_message(error));
}

static jbyteArray make_bytes(JNIEnv *env, const uint8_t *bytes, size_t length) {
  jbyteArray result = (*env)->NewByteArray(env, (jsize)length);
  if (result && length > 0) {
    (*env)->SetByteArrayRegion(env, result, 0, (jsize)length, (const jbyte *)bytes);
  }
  return result;
}

static uint8_t *copy_bytes(JNIEnv *env, jbyteArray value, size_t *length) {
  uint8_t *result;
  *length = (size_t)(*env)->GetArrayLength(env, value);
  result = (uint8_t *)malloc(*length > 0 ? *length : 1);
  if (!result) return NULL;
  if (*length > 0) {
    (*env)->GetByteArrayRegion(env, value, 0, (jsize)*length, (jbyte *)result);
  }
  return result;
}

JNIEXPORT jbyteArray JNICALL
Java_chat_psstpsst_app_noise_ExpoNoiseModule_generateKeyPairNative(
    JNIEnv *env,
    jobject self,
    jbyteArray seed) {
  uint8_t private_key[32];
  uint8_t public_key[32];
  uint8_t result[64];
  uint8_t *seed_bytes = NULL;
  size_t seed_length = 0;
  int error;
  (void)self;
  if (seed) {
    seed_bytes = copy_bytes(env, seed, &seed_length);
    if (!seed_bytes) return NULL;
  }
  error = psst_noise_keypair(seed_bytes, seed_length, private_key, public_key);
  if (seed_bytes) {
    memset(seed_bytes, 0, seed_length);
    free(seed_bytes);
  }
  if (error != PSST_NOISE_OK) {
    throw_noise_error(env, error);
    return NULL;
  }
  memcpy(result, private_key, 32);
  memcpy(result + 32, public_key, 32);
  memset(private_key, 0, sizeof(private_key));
  {
    jbyteArray output = make_bytes(env, result, sizeof(result));
    memset(result, 0, sizeof(result));
    return output;
  }
}

JNIEXPORT jlong JNICALL
Java_chat_psstpsst_app_noise_ExpoNoiseModule_createHandshakeNative(
    JNIEnv *env,
    jobject self,
    jboolean initiator,
    jbyteArray static_private_key,
    jbyteArray fixed_ephemeral_private_key) {
  PsstNoiseHandshake *handshake = NULL;
  uint8_t *static_bytes;
  uint8_t *ephemeral_bytes = NULL;
  size_t static_length;
  size_t ephemeral_length = 0;
  int error;
  (void)self;
  static_bytes = copy_bytes(env, static_private_key, &static_length);
  if (!static_bytes) return 0;
  if (fixed_ephemeral_private_key) {
    ephemeral_bytes = copy_bytes(env, fixed_ephemeral_private_key, &ephemeral_length);
    if (!ephemeral_bytes) {
      memset(static_bytes, 0, static_length);
      free(static_bytes);
      return 0;
    }
  }
  error = psst_noise_handshake_create(
      initiator ? 1 : 0,
      static_bytes,
      static_length,
      ephemeral_bytes,
      ephemeral_length,
      &handshake);
  memset(static_bytes, 0, static_length);
  free(static_bytes);
  if (ephemeral_bytes) {
    memset(ephemeral_bytes, 0, ephemeral_length);
    free(ephemeral_bytes);
  }
  if (error != PSST_NOISE_OK) {
    throw_noise_error(env, error);
    return 0;
  }
  return (jlong)(intptr_t)handshake;
}

JNIEXPORT jbyteArray JNICALL
Java_chat_psstpsst_app_noise_ExpoNoiseModule_writeHandshakeNative(
    JNIEnv *env,
    jobject self,
    jlong pointer,
    jbyteArray payload) {
  uint8_t *payload_bytes;
  uint8_t *output;
  size_t payload_length;
  size_t output_length = 0;
  int error;
  jbyteArray result;
  (void)self;
  payload_bytes = copy_bytes(env, payload, &payload_length);
  output = (uint8_t *)malloc(65535);
  if (!payload_bytes || !output) {
    free(payload_bytes);
    free(output);
    return NULL;
  }
  error = psst_noise_handshake_write(
      (PsstNoiseHandshake *)(intptr_t)pointer,
      payload_bytes,
      payload_length,
      output,
      65535,
      &output_length);
  memset(payload_bytes, 0, payload_length);
  free(payload_bytes);
  if (error != PSST_NOISE_OK) {
    free(output);
    throw_noise_error(env, error);
    return NULL;
  }
  result = make_bytes(env, output, output_length);
  free(output);
  return result;
}

JNIEXPORT jbyteArray JNICALL
Java_chat_psstpsst_app_noise_ExpoNoiseModule_readHandshakeNative(
    JNIEnv *env,
    jobject self,
    jlong pointer,
    jbyteArray message) {
  uint8_t *message_bytes;
  uint8_t *output;
  size_t message_length;
  size_t output_length = 0;
  int error;
  jbyteArray result;
  (void)self;
  message_bytes = copy_bytes(env, message, &message_length);
  output = (uint8_t *)malloc(65535);
  if (!message_bytes || !output) {
    free(message_bytes);
    free(output);
    return NULL;
  }
  error = psst_noise_handshake_read(
      (PsstNoiseHandshake *)(intptr_t)pointer,
      message_bytes,
      message_length,
      output,
      65535,
      &output_length);
  free(message_bytes);
  if (error != PSST_NOISE_OK) {
    free(output);
    throw_noise_error(env, error);
    return NULL;
  }
  result = make_bytes(env, output, output_length);
  free(output);
  return result;
}

JNIEXPORT jbyteArray JNICALL
Java_chat_psstpsst_app_noise_ExpoNoiseModule_getRemoteStaticKeyNative(
    JNIEnv *env,
    jobject self,
    jlong pointer) {
  uint8_t output[32];
  int error;
  (void)self;
  error = psst_noise_handshake_remote_static(
      (PsstNoiseHandshake *)(intptr_t)pointer,
      output);
  if (error != PSST_NOISE_OK) {
    throw_noise_error(env, error);
    return NULL;
  }
  return make_bytes(env, output, sizeof(output));
}

JNIEXPORT jbyteArray JNICALL
Java_chat_psstpsst_app_noise_ExpoNoiseModule_finishHandshakeNative(
    JNIEnv *env,
    jobject self,
    jlong pointer,
    jint max_record_size) {
  PsstNoiseSession *session = NULL;
  uint8_t session_id[32];
  uint8_t result[40];
  uint64_t encoded_pointer;
  int error;
  size_t index;
  (void)self;
  error = psst_noise_handshake_finish(
      (PsstNoiseHandshake *)(intptr_t)pointer,
      (size_t)max_record_size,
      &session,
      session_id);
  if (error != PSST_NOISE_OK) {
    throw_noise_error(env, error);
    return NULL;
  }
  encoded_pointer = (uint64_t)(uintptr_t)session;
  for (index = 0; index < 8; ++index) result[index] = (uint8_t)(encoded_pointer >> (index * 8));
  memcpy(result + 8, session_id, 32);
  return make_bytes(env, result, sizeof(result));
}

JNIEXPORT void JNICALL
Java_chat_psstpsst_app_noise_ExpoNoiseModule_destroyHandshakeNative(
    JNIEnv *env,
    jobject self,
    jlong pointer) {
  (void)env;
  (void)self;
  psst_noise_handshake_destroy((PsstNoiseHandshake *)(intptr_t)pointer);
}

JNIEXPORT jboolean JNICALL
Java_chat_psstpsst_app_noise_ExpoNoiseModule_shouldRotateSessionNative(
    JNIEnv *env,
    jobject self,
    jlong pointer,
    jint next_payload_length) {
  int should_rotate = 0;
  int error;
  (void)self;
  error = psst_noise_session_should_rotate(
      (PsstNoiseSession *)(intptr_t)pointer,
      (size_t)next_payload_length,
      &should_rotate);
  if (error != PSST_NOISE_OK) {
    throw_noise_error(env, error);
    return JNI_FALSE;
  }
  return should_rotate ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jbyteArray JNICALL
Java_chat_psstpsst_app_noise_ExpoNoiseModule_sealNative(
    JNIEnv *env,
    jobject self,
    jlong pointer,
    jint type,
    jbyteArray payload) {
  uint8_t *payload_bytes;
  uint8_t *output;
  size_t payload_length;
  size_t output_length = 0;
  int error;
  jbyteArray result;
  (void)self;
  if (type < 0 || type > 255) {
    throw_noise_error(env, PSST_NOISE_INVALID_ARGUMENT);
    return NULL;
  }
  payload_bytes = copy_bytes(env, payload, &payload_length);
  output = (uint8_t *)malloc(payload_length + 64);
  if (!payload_bytes || !output) {
    free(payload_bytes);
    free(output);
    return NULL;
  }
  error = psst_noise_session_seal(
      (PsstNoiseSession *)(intptr_t)pointer,
      (uint8_t)type,
      payload_bytes,
      payload_length,
      output,
      payload_length + 64,
      &output_length);
  memset(payload_bytes, 0, payload_length);
  free(payload_bytes);
  if (error != PSST_NOISE_OK) {
    free(output);
    throw_noise_error(env, error);
    return NULL;
  }
  result = make_bytes(env, output, output_length);
  free(output);
  return result;
}

JNIEXPORT jbyteArray JNICALL
Java_chat_psstpsst_app_noise_ExpoNoiseModule_openNative(
    JNIEnv *env,
    jobject self,
    jlong pointer,
    jbyteArray record) {
  uint8_t *record_bytes;
  uint8_t *output;
  uint8_t packet_type = 0;
  size_t record_length;
  size_t output_length = 0;
  int error;
  jbyteArray result;
  (void)self;
  record_bytes = copy_bytes(env, record, &record_length);
  output = (uint8_t *)malloc(record_length + 1);
  if (!record_bytes || !output) {
    free(record_bytes);
    free(output);
    return NULL;
  }
  error = psst_noise_session_open(
      (PsstNoiseSession *)(intptr_t)pointer,
      record_bytes,
      record_length,
      &packet_type,
      output + 1,
      record_length,
      &output_length);
  free(record_bytes);
  if (error != PSST_NOISE_OK) {
    free(output);
    throw_noise_error(env, error);
    return NULL;
  }
  output[0] = packet_type;
  result = make_bytes(env, output, output_length + 1);
  memset(output + 1, 0, output_length);
  free(output);
  return result;
}

JNIEXPORT void JNICALL
Java_chat_psstpsst_app_noise_ExpoNoiseModule_destroySessionNative(
    JNIEnv *env,
    jobject self,
    jlong pointer) {
  (void)env;
  (void)self;
  psst_noise_session_destroy((PsstNoiseSession *)(intptr_t)pointer);
}
