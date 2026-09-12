#import <Foundation/Foundation.h>

BOOL ExpoCryptoAcceleratorDeriveSharedX(const uint8_t privkey[32], const uint8_t pubkey[32], uint8_t output[32]);
BOOL ExpoCryptoAcceleratorVerifySchnorr(const uint8_t signature[64], const uint8_t message[32], const uint8_t pubkey[32]);
