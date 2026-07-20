# frozen_string_literal: true

require 'sketchup.rb' if defined?(Sketchup)
require_relative 'version'

unless defined?(JiancaiSpace::LOADED)
  require_relative 'main'
  JiancaiSpace.start if defined?(Sketchup)
  JiancaiSpace.const_set(:LOADED, true)
end
