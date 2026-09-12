Pod::Spec.new do |s|
  s.name           = 'ExpoProximity'
  s.version        = '0.1.0'
  s.summary        = 'BLE proximity transport for PsstPsst'
  s.description    = 'A BLE central and peripheral transport for nearby messages.'
  s.author         = 'psstpsst'
  s.homepage       = 'https://github.com/codytseng/psstpsst'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.0'
  s.source         = { :git => '' }
  s.source_files   = '**/*.swift'
  s.dependency 'ExpoModulesCore'
end
