cmake_minimum_required(VERSION 3.22)

project(psst_noise_core LANGUAGES C)

set(NOISE_C_ROOT "${CMAKE_CURRENT_LIST_DIR}/../vendor/noise-c")

set(PSST_NOISE_SOURCES
  psst_noise.c
  ${NOISE_C_ROOT}/src/protocol/cipherstate.c
  ${NOISE_C_ROOT}/src/protocol/dhstate.c
  ${NOISE_C_ROOT}/src/protocol/errors.c
  ${NOISE_C_ROOT}/src/protocol/handshakestate.c
  ${NOISE_C_ROOT}/src/protocol/hashstate.c
  ${NOISE_C_ROOT}/src/protocol/names.c
  ${NOISE_C_ROOT}/src/protocol/patterns.c
  ${NOISE_C_ROOT}/src/protocol/randstate.c
  ${NOISE_C_ROOT}/src/protocol/symmetricstate.c
  ${NOISE_C_ROOT}/src/protocol/util.c
  ${NOISE_C_ROOT}/src/protocol/rand_os.c
  ${NOISE_C_ROOT}/src/backend/ref/cipher-chachapoly.c
  ${NOISE_C_ROOT}/src/backend/ref/dh-curve25519.c
  ${NOISE_C_ROOT}/src/backend/ref/hash-sha256.c
  ${NOISE_C_ROOT}/src/crypto/chacha/chacha.c
  ${NOISE_C_ROOT}/src/crypto/donna/poly1305-donna.c
  ${NOISE_C_ROOT}/src/crypto/sha2/sha256.c
  ${NOISE_C_ROOT}/src/crypto/ed25519/ed25519.c
)

add_library(psst-noise-core STATIC ${PSST_NOISE_SOURCES})
target_compile_features(psst-noise-core PRIVATE c_std_11)
target_include_directories(psst-noise-core PUBLIC
  ${CMAKE_CURRENT_LIST_DIR}
  ${NOISE_C_ROOT}/include
  ${NOISE_C_ROOT}/src
  ${NOISE_C_ROOT}/src/protocol
)
target_compile_definitions(psst-noise-core PRIVATE
  ED25519_CUSTOMRANDOM=1
  ED25519_REFHASH=1
)

if(PSST_NOISE_BUILD_TESTS)
  enable_testing()
  add_executable(psst-noise-core-test psst_noise_test.c)
  target_link_libraries(psst-noise-core-test PRIVATE psst-noise-core)
  add_test(NAME psst-noise-core-test COMMAND psst-noise-core-test)
endif()
