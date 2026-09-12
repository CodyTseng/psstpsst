#include "psst_noise.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static void require_ok(int error) {
  if (error != PSST_NOISE_OK) {
    fprintf(stderr, "%s\n", psst_noise_error_message(error));
    assert(error == PSST_NOISE_OK);
  }
}

static uint8_t hex_nibble(char value) {
  if (value >= '0' && value <= '9') return (uint8_t)(value - '0');
  if (value >= 'a' && value <= 'f') return (uint8_t)(value - 'a' + 10);
  assert(0 && "invalid hexadecimal fixture");
  return 0;
}

static void require_hex(const uint8_t *actual, size_t actual_len, const char *expected) {
  size_t index;
  assert(strlen(expected) == actual_len * 2);
  for (index = 0; index < actual_len; ++index) {
    assert(actual[index] ==
        (uint8_t)((hex_nibble(expected[index * 2]) << 4) |
                  hex_nibble(expected[index * 2 + 1])));
  }
}

int main(void) {
  uint8_t initiator_static[32];
  uint8_t responder_static[32];
  uint8_t initiator_ephemeral[32];
  uint8_t responder_ephemeral[32];
  uint8_t private_key[32];
  uint8_t public_key[32];
  uint8_t message[65535];
  uint8_t payload[65535];
  uint8_t remote_static[32];
  uint8_t initiator_session_id[32];
  uint8_t responder_session_id[32];
  uint8_t record[65583];
  size_t message_len;
  size_t payload_len;
  size_t record_len;
  int low_order_error;
  uint8_t packet_type;
  PsstNoiseHandshake *initiator = NULL;
  PsstNoiseHandshake *responder = NULL;
  PsstNoiseHandshake *low_order_responder = NULL;
  PsstNoiseSession *initiator_session = NULL;
  PsstNoiseSession *responder_session = NULL;

  memset(initiator_static, 3, sizeof(initiator_static));
  memset(responder_static, 4, sizeof(responder_static));
  memset(initiator_ephemeral, 5, sizeof(initiator_ephemeral));
  memset(responder_ephemeral, 6, sizeof(responder_ephemeral));

  require_ok(psst_noise_keypair(
      initiator_static,
      sizeof(initiator_static),
      private_key,
      public_key));
  assert(memcmp(private_key, initiator_static, 32) == 0);

  require_ok(psst_noise_handshake_create(
      1,
      initiator_static,
      sizeof(initiator_static),
      initiator_ephemeral,
      sizeof(initiator_ephemeral),
      &initiator));
  require_ok(psst_noise_handshake_create(
      0,
      responder_static,
      sizeof(responder_static),
      responder_ephemeral,
      sizeof(responder_ephemeral),
      &responder));

  require_ok(psst_noise_handshake_write(
      initiator,
      (const uint8_t *)"client",
      6,
      message,
      sizeof(message),
      &message_len));
  require_hex(
      message,
      message_len,
      "50a61409b1ddd0325e9b16b700e719e9772c07000b1bd7786e907c653d20495d"
      "636c69656e74");
  require_ok(psst_noise_handshake_read(
      responder,
      message,
      message_len,
      payload,
      sizeof(payload),
      &payload_len));
  assert(payload_len == 6 && memcmp(payload, "client", 6) == 0);

  require_ok(psst_noise_handshake_write(
      responder,
      (const uint8_t *)"server",
      6,
      message,
      sizeof(message),
      &message_len));
  require_hex(
      message,
      message_len,
      "f5b2d6e60f9477e310c2982daaa6c9136c108a1777c5947e448fa37d68174557"
      "a16cb8fafe6fcec12593015a064545f434c5c48d8d154256ecdd2012848233a54e"
      "8c8f3ba12e4659ff7580e2d2ca43df8adf5024d09267ce107bf9e5d498a168e30"
      "c5525f5b8");
  require_ok(psst_noise_handshake_read(
      initiator,
      message,
      message_len,
      payload,
      sizeof(payload),
      &payload_len));
  assert(payload_len == 6 && memcmp(payload, "server", 6) == 0);
  require_ok(psst_noise_handshake_remote_static(initiator, remote_static));
  require_ok(psst_noise_keypair(
      responder_static,
      sizeof(responder_static),
      private_key,
      public_key));
  assert(memcmp(remote_static, public_key, 32) == 0);

  require_ok(psst_noise_handshake_write(
      initiator,
      NULL,
      0,
      message,
      sizeof(message),
      &message_len));
  require_hex(
      message,
      message_len,
      "c7e957e82bac138ecc5726d23d172ede00b769dba6d9b94d0d9eedf12f63cd78"
      "f37f3b03ba7632df270cc01f5f39436ba74d759946ad59b680e16b8f9b04a8b3");
  require_ok(psst_noise_handshake_read(
      responder,
      message,
      message_len,
      payload,
      sizeof(payload),
      &payload_len));
  assert(payload_len == 0);

  require_ok(psst_noise_handshake_finish(
      initiator,
      sizeof(record),
      &initiator_session,
      initiator_session_id));
  require_ok(psst_noise_handshake_finish(
      responder,
      sizeof(record),
      &responder_session,
      responder_session_id));
  assert(memcmp(initiator_session_id, responder_session_id, 32) == 0);
  require_hex(
      initiator_session_id,
      sizeof(initiator_session_id),
      "f1d3b4b90a649f15978f0d25a677bc76a1b94375f741173183d2d63bb73368a7");

  require_ok(psst_noise_session_seal(
      initiator_session,
      0x20,
      (const uint8_t *)"hello",
      5,
      record,
      sizeof(record),
      &record_len));
  require_ok(psst_noise_session_open(
      responder_session,
      record,
      record_len,
      &packet_type,
      payload,
      sizeof(payload),
      &payload_len));
  assert(packet_type == 0x20);
  assert(payload_len == 5 && memcmp(payload, "hello", 5) == 0);

  for (packet_type = 0x30; packet_type <= 0x36; ++packet_type) {
    uint8_t expected_type = packet_type;
    require_ok(psst_noise_session_seal(
        initiator_session,
        expected_type,
        (const uint8_t *)"file",
        4,
        record,
        sizeof(record),
        &record_len));
    require_ok(psst_noise_session_open(
        responder_session,
        record,
        record_len,
        &packet_type,
        payload,
        sizeof(payload),
        &payload_len));
    assert(packet_type == expected_type);
    assert(payload_len == 4 && memcmp(payload, "file", 4) == 0);
  }

  record[record_len - 1] ^= 1;
  assert(psst_noise_session_open(
      responder_session,
      record,
      record_len,
      &packet_type,
      payload,
      sizeof(payload),
      &payload_len) != PSST_NOISE_OK);
  assert(psst_noise_session_open(
      responder_session,
      record,
      record_len,
      &packet_type,
      payload,
      sizeof(payload),
      &payload_len) == PSST_NOISE_INVALID_STATE);

  require_ok(psst_noise_handshake_create(
      0,
      responder_static,
      sizeof(responder_static),
      responder_ephemeral,
      sizeof(responder_ephemeral),
      &low_order_responder));
  memset(message, 0, 32);
  low_order_error = psst_noise_handshake_read(
      low_order_responder,
      message,
      32,
      payload,
      sizeof(payload),
      &payload_len);
  if (low_order_error == PSST_NOISE_OK) {
    low_order_error = psst_noise_handshake_write(
        low_order_responder,
        (const uint8_t *)"server",
        6,
        message,
        sizeof(message),
        &message_len);
  }
  assert(low_order_error != PSST_NOISE_OK);
  assert(psst_noise_handshake_write(
      low_order_responder,
      (const uint8_t *)"server",
      6,
      message,
      sizeof(message),
      &message_len) == PSST_NOISE_INVALID_ARGUMENT);

  psst_noise_session_destroy(initiator_session);
  psst_noise_session_destroy(responder_session);
  psst_noise_handshake_destroy(initiator);
  psst_noise_handshake_destroy(responder);
  psst_noise_handshake_destroy(low_order_responder);
  return 0;
}
