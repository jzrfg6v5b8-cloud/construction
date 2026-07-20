# frozen_string_literal: true

require_relative 'geometry'

module JiancaiSpace
  class DimensionBuilder
    DICTIONARY = 'JiancaiSpace'.freeze

    def build(model, annotations)
      tag = model.layers['JS_尺寸'] || model.layers.add('JS_尺寸')
      existing = model.entities.grep(Sketchup::DimensionLinear).select do |dimension|
        dimension.get_attribute(DICTIONARY, 'managed') == true
      end
      existing.each(&:erase!)

      Array(annotations).each_with_index do |annotation, index|
        start_point = Geometry.point_mm(point(annotation.fetch('start')))
        end_point = Geometry.point_mm(point(annotation.fetch('end')))
        offset = Geom::Vector3d.new(0, 0, Geometry.inches(300 + (index * 120)))
        dimension = model.entities.add_dimension_linear(start_point, end_point, offset)
        dimension.layer = tag
        dimension.set_attribute(DICTIONARY, 'managed', true)
        dimension.set_attribute(DICTIONARY, 'uuid', annotation['objectId'])
        dimension.set_attribute(DICTIONARY, 'dimensionType', annotation['dimensionType'])
        dimension.set_attribute(DICTIONARY, 'verifiedValueMm', annotation['valueMm'])
      end
    end

    private

    def point(value)
      [value.fetch('xMm'), value.fetch('yMm'), value.fetch('zMm')]
    end
  end
end
