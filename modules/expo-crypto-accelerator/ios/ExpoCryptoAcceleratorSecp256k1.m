#import "ExpoCryptoAcceleratorSecp256k1.h"

#import <secp256k1.h>
#import <secp256k1_extrakeys.h>
#import <secp256k1_schnorrsig.h>

static secp256k1_context *ExpoCryptoAcceleratorContext(void) {
  static secp256k1_context *context = NULL;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    context = secp256k1_context_create(SECP256K1_CONTEXT_VERIFY);
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
