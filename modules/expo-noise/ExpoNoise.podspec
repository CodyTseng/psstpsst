Pod::Spec.new do |s|
  s.name           = 'ExpoNoise'
  s.version        = '0.1.0'
  s.summary        = 'Native Noise Protocol sessions for PsstPsst'
  s.description    = 'Off-thread, stateful Noise XX handshakes and transport encryption.'
  s.author         = 'psstpsst'
  s.homepage       = 'https://github.com/codytseng/psstpsst'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.0'
  s.source         = { :git => '' }
  s.static_framework = true

  root = 'vendor/noise-c'
  s.source_files = [
    'ios/**/*.{h,swift}',
    'common/psst_noise.{h,c}',
    "#{root}/include/**/*.h",
    "#{root}/src/protocol/{cipherstate,dhstate,errors,handshakestate,hashstate,names,patterns,randstate,symmetricstate,util,rand_os}.{h,c}",
    "#{root}/src/backend/ref/{cipher-chachapoly,dh-curve25519,hash-sha256}.c",
    "#{root}/src/crypto/chacha/*.{h,c}",
    "#{root}/src/crypto/donna/poly1305-donna*.h",
    "#{root}/src/crypto/donna/poly1305-donna.c",
    "#{root}/src/crypto/sha2/sha256.{h,c}",
    "#{root}/src/crypto/ed25519/*.h",
    "#{root}/src/crypto/ed25519/ed25519.c",
  ]
  s.preserve_paths = "#{root}/src/crypto/donna/curve25519-donna*.c"
  s.public_header_files = [
    'ios/ExpoNoise.h',
    'common/psst_noise.h',
  ]
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'USE_HEADERMAP' => 'NO',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) ED25519_CUSTOMRANDOM=1 ED25519_REFHASH=1',
    'USER_HEADER_SEARCH_PATHS' => '$(PODS_TARGET_SRCROOT)/vendor/noise-c/src/protocol',
    'HEADER_SEARCH_PATHS' => [
      '$(PODS_TARGET_SRCROOT)/common',
      '$(PODS_TARGET_SRCROOT)/vendor/noise-c/include',
      '$(PODS_TARGET_SRCROOT)/vendor/noise-c/src',
      '$(PODS_TARGET_SRCROOT)/vendor/noise-c/src/protocol',
    ].join(' '),
  }
  s.dependency 'ExpoModulesCore'
end
