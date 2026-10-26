#import <Foundation/Foundation.h>

BOOL ExpoCryptoAcceleratorDeriveSharedX(const uint8_t privkey[32], const uint8_t pubkey[32], uint8_t output[32]);
BOOL ExpoCryptoAcceleratorVerifySchnorr(const uint8_t signature[64], const uint8_t message[32], const uint8_t pubkey[32]);
BOOL PsstVaultPublicKey(const uint8_t secret[32], uint8_t output[32]);
BOOL PsstVaultSign(const uint8_t secret[32], const uint8_t digest[32], const uint8_t auxiliary[32], uint8_t output[64]);
void PsstVaultChaCha(const uint8_t key[32], const uint8_t nonce[12], const uint8_t *input, uint32_t size, uint8_t *output);

int PsstVaultPinDigest(const uint8_t *pin, size_t pin_length, const uint8_t *salt, size_t salt_length, uint8_t output[32]);
