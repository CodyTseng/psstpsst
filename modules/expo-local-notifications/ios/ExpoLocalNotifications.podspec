Pod::Spec.new do |s|
  s.name           = 'ExpoLocalNotifications'
  s.version        = '0.1.0'
  s.summary        = 'Local notifications and badges for PsstPsst'
  s.description    = 'System local notifications without a remote push SDK.'
  s.author         = 'psstpsst'
  s.homepage       = 'https://github.com/codytseng/psstpsst'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.0'
  s.source         = { :git => '' }
  s.source_files   = '**/*.swift'
  s.dependency 'ExpoModulesCore'
end
