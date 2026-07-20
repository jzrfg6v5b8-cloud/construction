# frozen_string_literal: true

require 'sketchup.rb' if defined?(Sketchup)
require 'extensions.rb' if defined?(Sketchup)

module JiancaiSpace
  EXTENSION_ID = 'com.sharkflows.space_configurator'.freeze
  ROOT = File.expand_path('jiancai_space', __dir__).freeze
end

if defined?(SketchupExtension) && !file_loaded?(__FILE__)
  extension = SketchupExtension.new('Sharkflows Space Configurator', File.join(JiancaiSpace::ROOT, 'loader'))
  extension.description = '从SpaceConfiguration JSON或受令牌保护的本机桥接服务创建可追溯SketchUp模型。'
  extension.version = '1.0.0'
  extension.creator = 'Sharkflows'
  extension.copyright = '2026 Sharkflows'
  Sketchup.register_extension(extension, true)
  file_loaded(__FILE__)
end
