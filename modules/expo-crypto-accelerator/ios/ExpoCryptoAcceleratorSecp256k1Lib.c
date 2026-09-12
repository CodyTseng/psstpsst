#if defined(__clang__)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wunused-function"
#pragma clang diagnostic ignored "-Wshorten-64-to-32"
#endif

#include "../android/src/main/cpp/secp256k1/src/secp256k1.c"
#include "../android/src/main/cpp/secp256k1/src/precomputed_ecmult.c"
#include "../android/src/main/cpp/secp256k1/src/precomputed_ecmult_gen.c"

#if defined(__clang__)
#pragma clang diagnostic pop
#endif
