Pod::Spec.new do |s|
  s.name           = 'ExpoCryptoAccelerator'
  s.version        = '0.1.0'
  s.summary        = 'Native cryptographic acceleration for PsstPsst'
  s.description    = 'Accelerated NIP-44 conversation key derivation and BIP-340 Schnorr verification for PsstPsst.'
  s.author         = 'psstpsst'
  s.homepage       = 'https://github.com/codytseng/psstpsst'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.0'
  s.source         = { :git => '' }
  s.source_files   = '**/*.{swift,h,m,c}'
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => [
      '$(PODS_TARGET_SRCROOT)/../android/src/main/cpp/secp256k1/include',
      '$(PODS_TARGET_SRCROOT)/../android/src/main/cpp/secp256k1/src',
    ].join(' '),
    'GCC_PREPROCESSOR_DEFINITIONS' => [
      '$(inherited)',
      'ENABLE_MODULE_EXTRAKEYS=1',
      'ENABLE_MODULE_SCHNORRSIG=1',
      'ECMULT_WINDOW_SIZE=15',
      'COMB_BLOCKS=43',
      'COMB_TEETH=6',
      'SECP256K1_NO_API_VISIBILITY_ATTRIBUTES=1',
    ].join(' '),
  }
  s.dependency 'ExpoModulesCore'
end
