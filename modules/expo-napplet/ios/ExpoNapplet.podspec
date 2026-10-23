Pod::Spec.new do |s|
  s.name = 'ExpoNapplet'
  s.version = '0.1.0'
  s.summary = 'Isolated napplet container and public resource transport'
  s.description = 'Sandboxed HTML applications with a frame-bound host bridge.'
  s.author = 'psstpsst'
  s.homepage = 'https://github.com/codytseng/psstpsst'
  s.license = 'MIT'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.0'
  s.source = { :git => '' }
  s.source_files = '**/*.swift'
  s.dependency 'ExpoModulesCore'
end
