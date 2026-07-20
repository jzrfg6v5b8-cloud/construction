# frozen_string_literal: true

require_relative 'geometry'

module JiancaiSpace
  class SceneBuilder
    STANDARD_SCENES = [
      ['平面', 'PLAN', [0, 0, 1], [0, 1, 0], false],
      ['尺寸平面', 'DIMENSIONED_PLAN', [0, 0, 1], [0, 1, 0], false],
      ['鸟瞰', 'AXONOMETRIC', [1, -1, 0.8], [0, 0, 1], true],
      ['客厅', 'LIVING_ROOM', [0.7, -1, 0.35], [0, 0, 1], true],
      ['主卧', 'MASTER_BEDROOM', [-0.7, 1, 0.3], [0, 0, 1], true],
      ['次卧', 'SECOND_BEDROOM', [0.7, 1, 0.3], [0, 0, 1], true],
      ['厨房', 'KITCHEN', [-1, -0.4, 0.25], [0, 0, 1], true],
      ['浴室', 'BATHROOM', [1, 0.4, 0.25], [0, 0, 1], true]
    ].freeze

    def build(model, document = {})
      bounds = model.bounds
      center = bounds.center
      distance = [bounds.width, bounds.height, bounds.depth, Geometry.inches(1000)].max * 2.5
      configured = Array(document['cameras']).to_h { |camera| [camera['sceneCode'].to_s, camera] }
      dimension_tag = model.layers['JS_尺寸']

      STANDARD_SCENES.each do |name, scene_code, direction, up, perspective|
        model.pages.erase(model.pages[name]) if model.pages[name]
        camera = configured_camera(configured[scene_code], perspective) ||
                 fallback_camera(center, distance, direction, up, perspective)
        model.active_view.camera = camera
        model.active_view.zoom_extents
        if dimension_tag
          dimension_tag.visible = name == '尺寸平面'
        end
        page = model.pages.add(name)
        page.set_attribute('JiancaiSpace', 'sceneCode', scene_code)
        page.set_attribute('JiancaiSpace', 'geometryVersion', document['geometryVersion'])
      end
      model.pages
    end

    private

    def configured_camera(source, perspective)
      return unless source

      camera = Sketchup::Camera.new(
        Geometry.point_mm(point(source.fetch('eye'))),
        Geometry.point_mm(point(source.fetch('target'))),
        Geom::Vector3d.new(source.dig('up', 'x'), source.dig('up', 'y'), source.dig('up', 'z'))
      )
      camera.perspective = perspective && source['projection'] != 'ORTHOGRAPHIC'
      camera
    end

    def fallback_camera(center, distance, direction, up, perspective)
      vector = Geom::Vector3d.new(*direction).normalize
      camera = Sketchup::Camera.new(center.offset(vector, distance), center, Geom::Vector3d.new(*up))
      camera.perspective = perspective
      camera
    end

    def point(value)
      [value.fetch('xMm'), value.fetch('yMm'), value.fetch('zMm')]
    end
  end
end
