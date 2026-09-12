#include "psst_noise.h"

#include <noise/protocol.h>

#include <stdlib.h>
#include <string.h>
#include <time.h>

#define PSST_NOISE_PROTOCOL "Noise_XX_25519_ChaChaPoly_SHA256"
#define PSST_NOISE_PROLOGUE "PsstPsst Nearby/1"
#define PSST_NOISE_VERSION 1
#define PSST_NOISE_HEADER_SIZE 48
#define PSST_NOISE_TAG_SIZE 16
#define PSST_NOISE_RECORD_OVERHEAD (PSST_NOISE_HEADER_SIZE + PSST_NOISE_TAG_SIZE)
#define PSST_NOISE_MIN_RECORD_SIZE 512
#define PSST_NOISE_MAX_RECORD_SIZE 65583
#define PSST_NOISE_MAX_RECORDS (1ULL << 20)
#define PSST_NOISE_MAX_SESSION_BYTES (64ULL * 1024ULL * 1024ULL * 1024ULL)
#define PSST_NOISE_MAX_SESSION_AGE_MS (24ULL * 60ULL * 60ULL * 1000ULL)
#define PSST_NOISE_ROTATION_MARGIN_MS 5000ULL

struct PsstNoiseHandshake {
  NoiseHandshakeState *state;
  int consumed;
};

struct PsstNoiseSession {
  NoiseCipherState *send;
  NoiseCipherState *receive;
  uint8_t session_id[32];
  uint64_t send_sequence;
  uint64_t receive_sequence;
  uint64_t sent_records;
  uint64_t received_records;
  uint64_t sent_bytes;
  uint64_t received_bytes;
  uint64_t started_at_ms;
  size_t max_record_size;
  int closed;
};

static void close_handshake(PsstNoiseHandshake *handshake) {
  if (!handshake || handshake->consumed) return;
  handshake->consumed = 1;
  if (handshake->state) {
    noise_handshakestate_free(handshake->state);
    handshake->state = NULL;
  }
}

static uint64_t now_ms(void) {
  struct timespec value;
#if defined(__ANDROID__) || defined(__APPLE__) || defined(CLOCK_MONOTONIC)
  if (clock_gettime(CLOCK_MONOTONIC, &value) == 0) {
    return ((uint64_t)value.tv_sec * 1000ULL) + ((uint64_t)value.tv_nsec / 1000000ULL);
  }
#endif
  return (uint64_t)time(NULL) * 1000ULL;
}

static void put_u16_be(uint8_t *output, uint16_t value) {
  output[0] = (uint8_t)(value >> 8);
  output[1] = (uint8_t)value;
}

static void put_u32_be(uint8_t *output, uint32_t value) {
  output[0] = (uint8_t)(value >> 24);
  output[1] = (uint8_t)(value >> 16);
  output[2] = (uint8_t)(value >> 8);
  output[3] = (uint8_t)value;
}

static void put_u64_be(uint8_t *output, uint64_t value) {
  size_t index;
  for (index = 0; index < 8; ++index) {
    output[index] = (uint8_t)(value >> (56 - (index * 8)));
  }
}

static uint16_t get_u16_be(const uint8_t *input) {
  return ((uint16_t)input[0] << 8) | input[1];
}

static uint32_t get_u32_be(const uint8_t *input) {
  return ((uint32_t)input[0] << 24) |
      ((uint32_t)input[1] << 16) |
      ((uint32_t)input[2] << 8) |
      input[3];
}

static uint64_t get_u64_be(const uint8_t *input) {
  uint64_t result = 0;
  size_t index;
  for (index = 0; index < 8; ++index) result = (result << 8) | input[index];
  return result;
}

static int secure_equal(const uint8_t *left, const uint8_t *right, size_t length) {
  uint8_t difference = 0;
  size_t index;
  for (index = 0; index < length; ++index) difference |= left[index] ^ right[index];
  return difference == 0;
}

static int valid_packet_type(uint8_t type) {
  switch (type) {
    case 0x10:
    case 0x11:
    case 0x12:
    case 0x13:
    case 0x14:
    case 0x20:
    case 0x21:
    case 0x30:
    case 0x31:
    case 0x32:
    case 0x33:
    case 0x34:
    case 0x35:
    case 0x36:
    case 0x7e:
    case 0x7f:
      return 1;
    default:
      return 0;
  }
}

static int map_noise_error(int error) {
  if (error == NOISE_ERROR_NONE) return PSST_NOISE_OK;
  if (error == NOISE_ERROR_MAC_FAILURE) return PSST_NOISE_AUTH_FAILED;
  if (error == NOISE_ERROR_INVALID_LENGTH) return PSST_NOISE_PAYLOAD_TOO_LARGE;
  if (error == NOISE_ERROR_INVALID_STATE) return PSST_NOISE_INVALID_STATE;
  if (error == NOISE_ERROR_INVALID_PARAM) return PSST_NOISE_INVALID_ARGUMENT;
  return PSST_NOISE_CRYPTO_ERROR;
}

static void close_session(PsstNoiseSession *session) {
  if (!session || session->closed) return;
  session->closed = 1;
  if (session->send) {
    noise_cipherstate_free(session->send);
    session->send = NULL;
  }
  if (session->receive) {
    noise_cipherstate_free(session->receive);
    session->receive = NULL;
  }
}

static int ensure_session_active(
    PsstNoiseSession *session,
    uint64_t records,
    uint64_t bytes) {
  if (!session || session->closed) return PSST_NOISE_INVALID_STATE;
  if (now_ms() - session->started_at_ms >= PSST_NOISE_MAX_SESSION_AGE_MS ||
      records >= PSST_NOISE_MAX_RECORDS ||
      bytes >= PSST_NOISE_MAX_SESSION_BYTES) {
    close_session(session);
    return PSST_NOISE_SESSION_EXPIRED;
  }
  return PSST_NOISE_OK;
}

int psst_noise_keypair(
    const uint8_t *private_key,
    size_t private_key_len,
    uint8_t out_private_key[32],
    uint8_t out_public_key[32]) {
  NoiseDHState *dh = NULL;
  int error;
  if (!out_private_key || !out_public_key ||
      ((!private_key && private_key_len != 0) ||
       (private_key && private_key_len != 32))) {
    return PSST_NOISE_INVALID_ARGUMENT;
  }
  error = noise_init();
  if (error != NOISE_ERROR_NONE) return map_noise_error(error);
  error = noise_dhstate_new_by_name(&dh, "25519");
  if (error == NOISE_ERROR_NONE) {
    error = private_key
        ? noise_dhstate_set_keypair_private(dh, private_key, private_key_len)
        : noise_dhstate_generate_keypair(dh);
  }
  if (error == NOISE_ERROR_NONE) {
    error = noise_dhstate_get_keypair(dh, out_private_key, 32, out_public_key, 32);
  }
  if (dh) noise_dhstate_free(dh);
  return map_noise_error(error);
}

int psst_noise_handshake_create(
    int initiator,
    const uint8_t *static_private_key,
    size_t static_private_key_len,
    const uint8_t *fixed_ephemeral_private_key,
    size_t fixed_ephemeral_private_key_len,
    PsstNoiseHandshake **out_handshake) {
  PsstNoiseHandshake *handshake;
  NoiseDHState *dh;
  int error;
  if (!static_private_key || static_private_key_len != 32 || !out_handshake ||
      (fixed_ephemeral_private_key && fixed_ephemeral_private_key_len != 32) ||
      (!fixed_ephemeral_private_key && fixed_ephemeral_private_key_len != 0)) {
    return PSST_NOISE_INVALID_ARGUMENT;
  }
  *out_handshake = NULL;
  handshake = (PsstNoiseHandshake *)calloc(1, sizeof(PsstNoiseHandshake));
  if (!handshake) return PSST_NOISE_CRYPTO_ERROR;
  error = noise_init();
  if (error == NOISE_ERROR_NONE) {
    error = noise_handshakestate_new_by_name(
        &handshake->state,
        PSST_NOISE_PROTOCOL,
        initiator ? NOISE_ROLE_INITIATOR : NOISE_ROLE_RESPONDER);
  }
  if (error == NOISE_ERROR_NONE) {
    error = noise_handshakestate_set_prologue(
        handshake->state,
        PSST_NOISE_PROLOGUE,
        strlen(PSST_NOISE_PROLOGUE));
  }
  if (error == NOISE_ERROR_NONE) {
    dh = noise_handshakestate_get_local_keypair_dh(handshake->state);
    error = noise_dhstate_set_keypair_private(dh, static_private_key, 32);
  }
  if (error == NOISE_ERROR_NONE && fixed_ephemeral_private_key) {
    dh = noise_handshakestate_get_fixed_ephemeral_dh(handshake->state);
    error = noise_dhstate_set_keypair_private(dh, fixed_ephemeral_private_key, 32);
  }
  if (error == NOISE_ERROR_NONE) error = noise_handshakestate_start(handshake->state);
  if (error != NOISE_ERROR_NONE) {
    psst_noise_handshake_destroy(handshake);
    return map_noise_error(error);
  }
  *out_handshake = handshake;
  return PSST_NOISE_OK;
}

int psst_noise_handshake_write(
    PsstNoiseHandshake *handshake,
    const uint8_t *payload,
    size_t payload_len,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_len) {
  NoiseBuffer message_buffer;
  NoiseBuffer payload_buffer;
  const NoiseBuffer *payload_pointer = NULL;
  int error;
  if (!handshake || !handshake->state || handshake->consumed || !output || !output_len ||
      (!payload && payload_len != 0)) {
    return PSST_NOISE_INVALID_ARGUMENT;
  }
  if (noise_handshakestate_get_action(handshake->state) != NOISE_ACTION_WRITE_MESSAGE) {
    close_handshake(handshake);
    return PSST_NOISE_INVALID_STATE;
  }
  if (payload_len > 65535 || output_capacity > 65535) {
    close_handshake(handshake);
    return PSST_NOISE_PAYLOAD_TOO_LARGE;
  }
  noise_buffer_set_output(message_buffer, output, output_capacity);
  if (payload_len > 0) {
    noise_buffer_set_input(payload_buffer, (uint8_t *)payload, payload_len);
    payload_pointer = &payload_buffer;
  }
  error = noise_handshakestate_write_message(
      handshake->state,
      &message_buffer,
      payload_pointer);
  if (error != NOISE_ERROR_NONE) {
    close_handshake(handshake);
    return map_noise_error(error);
  }
  *output_len = message_buffer.size;
  return PSST_NOISE_OK;
}

int psst_noise_handshake_read(
    PsstNoiseHandshake *handshake,
    const uint8_t *message,
    size_t message_len,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_len) {
  NoiseBuffer message_buffer;
  NoiseBuffer payload_buffer;
  uint8_t *message_copy;
  int error;
  if (!handshake || !handshake->state || handshake->consumed || !message || !output ||
      !output_len || message_len > 65535 || output_capacity > 65535) {
    return PSST_NOISE_INVALID_ARGUMENT;
  }
  if (noise_handshakestate_get_action(handshake->state) != NOISE_ACTION_READ_MESSAGE) {
    close_handshake(handshake);
    return PSST_NOISE_INVALID_STATE;
  }
  message_copy = (uint8_t *)malloc(message_len);
  if (!message_copy) return PSST_NOISE_CRYPTO_ERROR;
  memcpy(message_copy, message, message_len);
  noise_buffer_set_input(message_buffer, message_copy, message_len);
  noise_buffer_set_output(payload_buffer, output, output_capacity);
  error = noise_handshakestate_read_message(
      handshake->state,
      &message_buffer,
      &payload_buffer);
  noise_free(message_copy, message_len);
  if (error != NOISE_ERROR_NONE) {
    close_handshake(handshake);
    return map_noise_error(error);
  }
  *output_len = payload_buffer.size;
  return PSST_NOISE_OK;
}

int psst_noise_handshake_remote_static(
    PsstNoiseHandshake *handshake,
    uint8_t output[32]) {
  NoiseDHState *remote;
  if (!handshake || !handshake->state || handshake->consumed || !output) {
    return PSST_NOISE_INVALID_ARGUMENT;
  }
  remote = noise_handshakestate_get_remote_public_key_dh(handshake->state);
  if (!remote || !noise_dhstate_has_public_key(remote)) return PSST_NOISE_INVALID_STATE;
  return map_noise_error(noise_dhstate_get_public_key(remote, output, 32));
}

int psst_noise_handshake_finish(
    PsstNoiseHandshake *handshake,
    size_t max_record_size,
    PsstNoiseSession **out_session,
    uint8_t out_session_id[32]) {
  PsstNoiseSession *session;
  int error;
  if (!handshake || !handshake->state || handshake->consumed || !out_session ||
      !out_session_id || max_record_size < PSST_NOISE_MIN_RECORD_SIZE ||
      max_record_size > PSST_NOISE_MAX_RECORD_SIZE) {
    close_handshake(handshake);
    return PSST_NOISE_INVALID_ARGUMENT;
  }
  if (noise_handshakestate_get_action(handshake->state) != NOISE_ACTION_SPLIT) {
    close_handshake(handshake);
    return PSST_NOISE_INVALID_STATE;
  }
  *out_session = NULL;
  session = (PsstNoiseSession *)calloc(1, sizeof(PsstNoiseSession));
  if (!session) return PSST_NOISE_CRYPTO_ERROR;
  error = noise_handshakestate_get_handshake_hash(
      handshake->state,
      session->session_id,
      sizeof(session->session_id));
  if (error == NOISE_ERROR_NONE) {
    error = noise_handshakestate_split(handshake->state, &session->send, &session->receive);
  }
  if (error != NOISE_ERROR_NONE) {
    psst_noise_session_destroy(session);
    close_handshake(handshake);
    return map_noise_error(error);
  }
  session->max_record_size = max_record_size;
  session->started_at_ms = now_ms();
  memcpy(out_session_id, session->session_id, 32);
  close_handshake(handshake);
  *out_session = session;
  return PSST_NOISE_OK;
}

void psst_noise_handshake_destroy(PsstNoiseHandshake *handshake) {
  if (!handshake) return;
  if (handshake->state) noise_handshakestate_free(handshake->state);
  noise_free(handshake, sizeof(PsstNoiseHandshake));
}

int psst_noise_session_should_rotate(
    PsstNoiseSession *session,
    size_t next_payload_len,
    int *out_should_rotate) {
  uint64_t age;
  if (!session || !out_should_rotate || session->closed) return PSST_NOISE_INVALID_STATE;
  if (next_payload_len > 65535 - PSST_NOISE_TAG_SIZE) {
    return PSST_NOISE_INVALID_ARGUMENT;
  }
  age = now_ms() - session->started_at_ms;
  *out_should_rotate =
      age >= PSST_NOISE_MAX_SESSION_AGE_MS - PSST_NOISE_ROTATION_MARGIN_MS ||
      session->sent_records >= PSST_NOISE_MAX_RECORDS - 1 ||
      session->received_records >= PSST_NOISE_MAX_RECORDS - 1 ||
      next_payload_len >= PSST_NOISE_MAX_SESSION_BYTES - session->sent_bytes ||
      session->received_bytes >= PSST_NOISE_MAX_SESSION_BYTES;
  return PSST_NOISE_OK;
}

int psst_noise_session_seal(
    PsstNoiseSession *session,
    uint8_t packet_type,
    const uint8_t *payload,
    size_t payload_len,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_len) {
  NoiseBuffer cipher_buffer;
  uint8_t *header;
  int error = ensure_session_active(
      session,
      session ? session->sent_records : 0,
      session ? session->sent_bytes : 0);
  if (error != PSST_NOISE_OK) return error;
  if (!valid_packet_type(packet_type) || (!payload && payload_len != 0) || !output || !output_len) {
    close_session(session);
    return PSST_NOISE_INVALID_ARGUMENT;
  }
  if (payload_len > 65535 - PSST_NOISE_TAG_SIZE ||
      payload_len > session->max_record_size - PSST_NOISE_RECORD_OVERHEAD) {
    close_session(session);
    return PSST_NOISE_PAYLOAD_TOO_LARGE;
  }
  if (payload_len > 0 &&
      payload_len >= PSST_NOISE_MAX_SESSION_BYTES - session->sent_bytes) {
    close_session(session);
    return PSST_NOISE_SESSION_EXPIRED;
  }
  if (output_capacity < payload_len + PSST_NOISE_RECORD_OVERHEAD) {
    close_session(session);
    return PSST_NOISE_BUFFER_TOO_SMALL;
  }
  header = output;
  memset(header, 0, PSST_NOISE_HEADER_SIZE);
  header[0] = PSST_NOISE_VERSION;
  header[1] = packet_type;
  put_u16_be(header + 2, 0);
  memcpy(header + 4, session->session_id, 32);
  put_u64_be(header + 36, session->send_sequence);
  put_u32_be(header + 44, (uint32_t)payload_len);
  if (payload_len > 0) memcpy(output + PSST_NOISE_HEADER_SIZE, payload, payload_len);
  noise_buffer_set_inout(
      cipher_buffer,
      output + PSST_NOISE_HEADER_SIZE,
      payload_len,
      output_capacity - PSST_NOISE_HEADER_SIZE);
  error = map_noise_error(noise_cipherstate_encrypt_with_ad(
      session->send,
      header,
      PSST_NOISE_HEADER_SIZE,
      &cipher_buffer));
  if (error != PSST_NOISE_OK) {
    close_session(session);
    return error;
  }
  session->send_sequence += 1;
  session->sent_records += 1;
  session->sent_bytes += payload_len;
  *output_len = PSST_NOISE_HEADER_SIZE + cipher_buffer.size;
  return PSST_NOISE_OK;
}

int psst_noise_session_open(
    PsstNoiseSession *session,
    const uint8_t *record,
    size_t record_len,
    uint8_t *out_packet_type,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_len) {
  NoiseBuffer cipher_buffer;
  uint8_t *cipher_copy;
  const uint8_t *header;
  uint32_t payload_len;
  int error = ensure_session_active(
      session,
      session ? session->received_records : 0,
      session ? session->received_bytes : 0);
  if (error != PSST_NOISE_OK) return error;
  if (!record || !out_packet_type || !output || !output_len ||
      record_len < PSST_NOISE_RECORD_OVERHEAD || record_len > session->max_record_size) {
    close_session(session);
    return PSST_NOISE_INVALID_ARGUMENT;
  }
  header = record;
  payload_len = get_u32_be(header + 44);
  if (header[0] != PSST_NOISE_VERSION || !valid_packet_type(header[1]) ||
      get_u16_be(header + 2) != 0 ||
      !secure_equal(header + 4, session->session_id, 32) ||
      get_u64_be(header + 36) != session->receive_sequence ||
      (size_t)payload_len + PSST_NOISE_RECORD_OVERHEAD != record_len ||
      output_capacity < payload_len) {
    close_session(session);
    return PSST_NOISE_INVALID_STATE;
  }
  if (payload_len > 0 &&
      payload_len >= PSST_NOISE_MAX_SESSION_BYTES - session->received_bytes) {
    close_session(session);
    return PSST_NOISE_SESSION_EXPIRED;
  }
  cipher_copy = (uint8_t *)malloc(record_len - PSST_NOISE_HEADER_SIZE);
  if (!cipher_copy) {
    close_session(session);
    return PSST_NOISE_CRYPTO_ERROR;
  }
  memcpy(
      cipher_copy,
      record + PSST_NOISE_HEADER_SIZE,
      record_len - PSST_NOISE_HEADER_SIZE);
  noise_buffer_set_inout(
      cipher_buffer,
      cipher_copy,
      record_len - PSST_NOISE_HEADER_SIZE,
      record_len - PSST_NOISE_HEADER_SIZE);
  error = map_noise_error(noise_cipherstate_decrypt_with_ad(
      session->receive,
      header,
      PSST_NOISE_HEADER_SIZE,
      &cipher_buffer));
  if (error == PSST_NOISE_OK && cipher_buffer.size != payload_len) {
    error = PSST_NOISE_INVALID_STATE;
  }
  if (error == PSST_NOISE_OK && payload_len > 0) memcpy(output, cipher_copy, payload_len);
  noise_free(cipher_copy, record_len - PSST_NOISE_HEADER_SIZE);
  if (error != PSST_NOISE_OK) {
    close_session(session);
    return error;
  }
  session->receive_sequence += 1;
  session->received_records += 1;
  session->received_bytes += payload_len;
  *out_packet_type = header[1];
  *output_len = payload_len;
  return PSST_NOISE_OK;
}

void psst_noise_session_destroy(PsstNoiseSession *session) {
  if (!session) return;
  close_session(session);
  noise_free(session, sizeof(PsstNoiseSession));
}

const char *psst_noise_error_message(int error) {
  switch (error) {
    case PSST_NOISE_OK:
      return "Success";
    case PSST_NOISE_INVALID_ARGUMENT:
      return "Invalid Noise argument";
    case PSST_NOISE_INVALID_STATE:
      return "Invalid Noise session state";
    case PSST_NOISE_CRYPTO_ERROR:
      return "Noise cryptographic operation failed";
    case PSST_NOISE_BUFFER_TOO_SMALL:
      return "Noise output buffer is too small";
    case PSST_NOISE_PAYLOAD_TOO_LARGE:
      return "Noise payload is too large";
    case PSST_NOISE_SESSION_EXPIRED:
      return "Noise session expired";
    case PSST_NOISE_AUTH_FAILED:
      return "Noise authentication failed";
    default:
      return "Unknown Noise error";
  }
}
