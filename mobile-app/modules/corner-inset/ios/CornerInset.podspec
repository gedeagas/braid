Pod::Spec.new do |s|
  s.name           = 'CornerInset'
  s.version        = '1.0.0'
  s.summary        = 'iPadOS 26 window-control (corner adaptation margin) inset for React Native.'
  s.description    = 'Exposes the iPadOS 26 Corner Adaptation Margin LayoutRegion as a React Native measuring view so custom headers can dodge the window controls.'
  s.author         = 'Braid'
  s.homepage       = 'https://github.com/stablyai/braid'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
