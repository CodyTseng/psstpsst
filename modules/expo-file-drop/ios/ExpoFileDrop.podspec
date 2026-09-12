Pod::Spec.new do |s|
  s.name           = 'ExpoFileDrop'
  s.version        = '0.1.0'
  s.summary        = 'Native file drop targets for PsstPsst'
  s.description    = 'Receives files dragged into PsstPsst on iOS and Android.'
  s.author         = 'psstpsst'
  s.homepage       = 'https://github.com/codytseng/psstpsst'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.0'
  s.source         = { git: '' }
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
