# frozen_string_literal: true

require_relative 'errors'

module JiancaiSpace
  class Validator
    UUID_PATTERN = /\A[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/i
    REQUIRED_COLLECTIONS = %w[
      walls openings windows doors fixedZones partitions rooms products
      materials cameras dimensionAnnotations
    ].freeze

    def validate!(document)
      raise ValidationError, '根节点必须是 JSON object' unless document.is_a?(Hash)

      issues = []
      %w[schemaVersion projectId floorPlanCode geometryVersion ceilingHeightMm].each do |key|
        issues << "#{key} 必填" if document[key].nil? || document[key].to_s.empty?
      end
      issues << 'schemaVersion 必须为 1.0.0' unless document['schemaVersion'] == '1.0.0'
      issues << 'ceilingHeightMm 必须大于0' unless positive?(document['ceilingHeightMm'])
      issues << '未审核尺寸不能进入SketchUp建模' unless document['dimensionsVerified'] == true
      REQUIRED_COLLECTIONS.each { |key| issues << "#{key} 必须是数组" unless document[key].is_a?(Array) }
      validate_objects(document, issues) if issues.none? { |item| item.include?('必须是数组') }
      raise ValidationError, issues unless issues.empty?

      document
    end

    private

    def validate_objects(document, issues)
      stable = []
      %w[walls openings windows doors fixedZones partitions rooms products cameras dimensionAnnotations].each do |collection|
        document.fetch(collection, []).each_with_index do |record, index|
          unless record.is_a?(Hash)
            issues << "#{collection}[#{index}] 必须是object"
            next
          end
          id = record['objectId'].to_s
          issues << "#{collection}[#{index}].objectId不是稳定UUID" unless UUID_PATTERN.match?(id)
          issues << "objectId重复: #{id}" if stable.include?(id)
          stable << id
        end
      end

      wall_ids = Array(document['walls']).map { |wall| wall['objectId'] } +
                 Array(document['partitions']).map { |wall| wall['objectId'] }
      walls_by_id = (Array(document['walls']) + Array(document['partitions']))
        .to_h { |wall| [wall['objectId'], wall] }
      room_ids = Array(document['rooms']).map { |room| room['objectId'] }
      material_codes = Array(document['materials']).map { |material| material['materialCode'] }

      (Array(document['walls']) + Array(document['partitions'])).each do |wall|
        validate_linear_geometry(wall, wall['objectId'], issues)
      end
      Array(document['openings']).each do |opening|
        issues << "#{opening['objectId']}: hostObjectId不存在" unless wall_ids.include?(opening['hostObjectId'])
        %w[widthMm heightMm].each { |key| issues << "#{opening['objectId']}: #{key}无效" unless positive?(opening[key]) }
        issues << "#{opening['objectId']}: offsetMm无效" unless nonnegative?(opening['offsetMm'])
        host = walls_by_id[opening['hostObjectId']]
        if host && point?(host['start']) && point?(host['end']) &&
           opening['offsetMm'].is_a?(Numeric) && opening['widthMm'].is_a?(Numeric)
          length = Math.hypot(
            host['end']['xMm'] - host['start']['xMm'],
            host['end']['yMm'] - host['start']['yMm']
          )
          issues << "#{opening['objectId']}: 开口超出墙体长度" if opening['offsetMm'] + opening['widthMm'] > length
          if opening['sillHeightMm'].is_a?(Numeric) && opening['heightMm'].is_a?(Numeric) &&
             opening['sillHeightMm'] + opening['heightMm'] > host['heightMm']
            issues << "#{opening['objectId']}: 开口超出墙体高度"
          end
        end
      end
      Array(document['doors']).each do |door|
        issues << "#{door['objectId']}: hostObjectId不存在" unless wall_ids.include?(door['hostObjectId'])
        validate_dimensions(door, door['objectId'], issues)
      end
      Array(document['products']).each do |product|
        validate_dimensions(product, product['objectId'], issues)
        issues << "#{product['objectId']}: roomId不存在" unless room_ids.include?(product['roomId'])
        issues << "#{product['objectId']}: materialCode不存在" unless material_codes.include?(product['materialCode'])
        issues << "#{product['objectId']}: sku必填" if product['sku'].to_s.empty?
        issues << "#{product['objectId']}: componentDefinition必填" if product['componentDefinition'].to_s.empty?
        issues << "#{product['objectId']}: verificationStatus无效" unless %w[UNVERIFIED LOW_CONFIDENCE REVIEWED VERIFIED REJECTED].include?(product['verificationStatus'])
        forbidden = %w[scale scaleX scaleY scaleZ transformation matrix].select { |key| product.key?(key) }
        issues << "#{product['objectId']}: 禁止任意非等比缩放（#{forbidden.join(', ')}）" unless forbidden.empty?
      end
    end

    def validate_linear_geometry(record, label, issues)
      %w[heightMm thicknessMm].each { |key| issues << "#{label}: #{key}必须大于0" unless positive?(record[key]) }
      start_point = record['start']
      end_point = record['end']
      unless point?(start_point) && point?(end_point)
        issues << "#{label}: start/end必须为毫米坐标"
        return
      end
      if start_point['xMm'] == end_point['xMm'] && start_point['yMm'] == end_point['yMm']
        issues << "#{label}: 起终点不能重合"
      end
    end

    def validate_dimensions(record, label, issues)
      %w[widthMm depthMm heightMm].each { |key| issues << "#{label}: #{key}必须大于0mm" unless positive?(record[key]) }
    end

    def point?(value)
      value.is_a?(Hash) && %w[xMm yMm zMm].all? { |key| value[key].is_a?(Numeric) && value[key].finite? }
    end

    def positive?(value)
      value.is_a?(Numeric) && value.positive? && value.finite?
    end

    def nonnegative?(value)
      value.is_a?(Numeric) && value >= 0 && value.finite?
    end
  end
end
