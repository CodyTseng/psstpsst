#ifndef PSST_NOISE_H
#define PSST_NOISE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct PsstNoiseHandshake PsstNoiseHandshake;
typedef struct PsstNoiseSession PsstNoiseSession;

enum {
  PSST_NOISE_OK = 0,
  PSST_NOISE_INVALID_ARGUMENT = 1,
  PSST_NOISE_INVALID_STATE = 2,
  PSST_NOISE_CRYPTO_ERROR = 3,
  PSST_NOISE_BUFFER_TOO_SMALL = 4,
  PSST_NOISE_PAYLOAD_TOO_LARGE = 5,
  PSST_NOISE_SESSION_EXPIRED = 6,
  PSST_NOISE_AUTH_FAILED = 7,
};

int psst_noise_keypair(
    const uint8_t *private_key,
    size_t private_key_len,
    uint8_t out_private_key[32],
    uint8_t out_public_key[32]);

int psst_noise_handshake_create(
    int initiator,
    const uint8_t *static_private_key,
    size_t static_private_key_len,
    const uint8_t *fixed_ephemeral_private_key,
    size_t fixed_ephemeral_private_key_len,
    PsstNoiseHandshake **out_handshake);

int psst_noise_handshake_write(
    PsstNoiseHandshake *handshake,
    const uint8_t *payload,
    size_t payload_len,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_len);

int psst_noise_handshake_read(
    PsstNoiseHandshake *handshake,
    const uint8_t *message,
    size_t message_len,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_len);

int psst_noise_handshake_remote_static(
    PsstNoiseHandshake *handshake,
    uint8_t output[32]);

int psst_noise_handshake_finish(
    PsstNoiseHandshake *handshake,
    size_t max_record_size,
    PsstNoiseSession **out_session,
    uint8_t out_session_id[32]);

void psst_noise_handshake_destroy(PsstNoiseHandshake *handshake);

int psst_noise_session_should_rotate(
    PsstNoiseSession *session,
    size_t next_payload_len,
    int *out_should_rotate);

int psst_noise_session_seal(
    PsstNoiseSession *session,
    uint8_t packet_type,
    const uint8_t *payload,
    size_t payload_len,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_len);

int psst_noise_session_open(
    PsstNoiseSession *session,
    const uint8_t *record,
    size_t record_len,
    uint8_t *out_packet_type,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_len);

void psst_noise_session_destroy(PsstNoiseSession *session);

const char *psst_noise_error_message(int error);

#ifdef __cplusplus
}
#endif

#endif
