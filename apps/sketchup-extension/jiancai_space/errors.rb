# frozen_string_literal: true

module JiancaiSpace
  class Error < StandardError; end
  class ValidationError < Error
    attr_reader :issues

    def initialize(issues)
      @issues = Array(issues)
      super(@issues.join("\n"))
    end
  end
  class BridgeError < Error; end
  class ProjectConflictError < Error; end
  class ComponentError < Error; end
end
