/* The upstream reference implementation runs exclusively on native vault queues. */
#include "scrypt/insecure_memzero.c"
#include "scrypt/sha256.c"
#include "scrypt/crypto_scrypt-ref.c"

int PsstVaultPinDigest(const uint8_t *pin, size_t pin_length, const uint8_t *salt, size_t salt_length, uint8_t output[32]) {
  return crypto_scrypt(pin, pin_length, salt, salt_length, 32768, 8, 1, output, 32) == 0;
}
