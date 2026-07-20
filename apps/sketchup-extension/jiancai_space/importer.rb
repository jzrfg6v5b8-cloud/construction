# frozen_string_literal: true

require 'json'
require_relative 'validator'
require_relative 'protocol_adapter'

module JiancaiSpace
  class Importer
    MAX_BYTES = 20 * 1024 * 1024

    def initialize(validator: Validator.new)
      @validator = validator
    end

    def from_file(path)
      raise ValidationError, '未选择 JSON 文件' if path.to_s.empty?
      raise ValidationError, '只允许导入 .json 文件' unless File.extname(path).downcase == '.json'
      raise ValidationError, 'JSON 文件超过 20 MB' if File.size(path) > MAX_BYTES

      parse(File.binread(path, MAX_BYTES + 1))
    rescue Errno::ENOENT, Errno::EACCES => e
      raise ValidationError, "无法读取文件: #{e.message}"
    end

    def parse(json)
      document = JSON.parse(json)
      @validator.validate!(document)
      ProtocolAdapter.normalize(document)
    rescue JSON::ParserError => e
      raise ValidationError, "JSON 格式错误: #{e.message}"
    end
  end
end
