# frozen_string_literal: true

require 'json'
require_relative 'geometry'
require_relative 'errors'

module JiancaiSpace
  class ComponentLibrary
    DICTIONARY = 'JiancaiSpace'.freeze

    def initialize(manifest_path: File.join(__dir__, 'components', 'manifest.json'))
      manifest = JSON.parse(File.read(manifest_path))
      @specs = manifest.fetch('components').each_with_object({}) { |item, memo| memo[item['type']] = item }
      @asset_dir = File.dirname(manifest_path)
    end

    def constrain(type, requested = {})
      spec = @specs[type] || raise(ComponentError, "未知组件类型: #{type}")
      dimensions = {}
      %w[width depth height].each do |axis|
        value = requested["#{axis}Mm"] || requested[axis] || spec['defaults'][axis]
        value = Float(value)
        minimum = Float(spec['min'][axis])
        maximum = Float(spec['max'][axis])
        unless value.between?(minimum, maximum)
          raise ComponentError, "#{spec['name']} #{axis}=#{value}mm 超出 #{minimum}..#{maximum}mm"
        end
        dimensions[axis] = value
      rescue ArgumentError, TypeError
        raise ComponentError, "#{spec['name']} #{axis} 必须是数值"
      end
      dimensions
    end

    def add_instance(model, object)
      type = object.fetch('componentType')
      spec = @specs[type] || raise(ComponentError, "未知组件类型: #{type}")
      dimensions = constrain(type, object['dimensions'] || {})
      definition = exact_binary_definition(model, spec, dimensions) ||
                   placeholder_definition(model, spec, dimensions)
      transform = Geometry.transformation(object.fetch('positionMm'), object.fetch('rotationDeg', 0))
      instance = model.entities.add_instance(definition, transform)
      instance.name = object['name'] || spec['name']
      instance.locked = true if object['fixed'] || object['locked']
      apply_attributes(instance, object, spec, dimensions)
      instance
    end

    def upsert_instance(model, object, existing = nil)
      return add_instance(model, object) unless existing&.valid? && existing.respond_to?(:definition=)

      type = object.fetch('componentType')
      spec = @specs[type] || raise(ComponentError, "未知组件类型: #{type}")
      dimensions = constrain(type, object['dimensions'] || {})
      definition = exact_binary_definition(model, spec, dimensions) ||
                   placeholder_definition(model, spec, dimensions)
      existing.definition = definition
      existing.transformation = Geometry.transformation(object.fetch('positionMm'), object.fetch('rotationDeg', 0))
      existing.name = object['name'] || spec['name']
      existing.locked = !!(object['fixed'] || object['locked'])
      apply_attributes(existing, object, spec, dimensions)
      existing
    end

    private

    def exact_binary_definition(model, spec, dimensions)
      return unless dimensions == spec['defaults'].transform_values(&:to_f)
      path = File.join(@asset_dir, "#{spec['type']}.skp")
      return unless File.file?(path)

      model.definitions.load(path)
    end

    def placeholder_definition(model, spec, dimensions)
      key = dimensions.values.map { |value| value.round(2) }.join('x')
      name = "JS_PLACEHOLDER_#{spec['type']}_#{key}"
      existing = model.definitions[name]
      return existing if existing

      definition = model.definitions.add(name)
      Geometry.build_box(
        definition.entities,
        width_mm: dimensions['width'],
        depth_mm: dimensions['depth'],
        height_mm: dimensions['height']
      )
      definition.set_attribute(DICTIONARY, 'placeholder', true)
      definition.set_attribute(DICTIONARY, 'parametricStrategy', 'ruby-regeneration')
      definition.set_attribute(DICTIONARY, 'nonUniformScalingAllowed', false)
      definition
    end

    def apply_attributes(instance, object, spec, dimensions)
      values = {
        'uuid' => object['uuid'],
        'projectId' => object['projectId'],
        'objectType' => 'component',
        'componentType' => object['componentType'],
        'sku' => object['sku'] || spec['sku'],
        'materialId' => object['materialId'],
        'dimensionsMm' => JSON.generate(dimensions),
        'verificationStatus' => object['verificationStatus'],
        'locked' => !!(object['fixed'] || object['locked']),
        'placeholder' => instance.definition.get_attribute(DICTIONARY, 'placeholder', false)
      }
      values.each { |key, value| instance.set_attribute(DICTIONARY, key, value) unless value.nil? }
    end
  end
end
