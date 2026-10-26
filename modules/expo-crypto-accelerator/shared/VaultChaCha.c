#include "../../expo-noise/vendor/noise-c/src/crypto/chacha/chacha.c"

/* RFC 8439 layout: counter32 || nonce96, using the existing vetted core. */
void PsstVaultChaCha(const uint8_t key[32], const uint8_t nonce[12], const uint8_t *input, uint32_t size, uint8_t *output) {
  chacha_ctx context;
  uint8_t counter[8] = {0};
  memcpy(counter + 4, nonce, 4);
  chacha_keysetup(&context, key, 256);
  chacha_ivsetup(&context, nonce + 4, counter);
  chacha_encrypt_bytes(&context, input, output, size);
  volatile uint8_t *p = (volatile uint8_t *)&context;
  for (size_t i = 0; i < sizeof(context); i++) p[i] = 0;
}
