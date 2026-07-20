# frozen_string_literal: true

module JiancaiSpace
  module Geometry
    MM_PER_INCH = 25.4
    module_function

    def inches(mm)
      Float(mm) / MM_PER_INCH
    end

    def point_mm(value)
      coordinates = Array(value) + [0, 0, 0]
      Geom::Point3d.new(*coordinates.first(3).map { |item| inches(item) })
    end

    def build_wall(entities, wall)
      start_xy = wall.fetch('startMm')
      end_xy = wall.fetch('endMm')
      dx = end_xy[0] - start_xy[0]
      dy = end_xy[1] - start_xy[1]
      length_mm = Math.sqrt((dx * dx) + (dy * dy))
      ux = dx / length_mm
      uy = dy / length_mm
      height = inches(wall.fetch('heightMm'))
      thickness = inches(wall.fetch('thicknessMm'))
      origin = point_mm(start_xy)
      along = Geom::Vector3d.new(ux, uy, 0)
      up = Geom::Vector3d.new(0, 0, 1)

      outer = [
        origin,
        origin.offset(along, inches(length_mm)),
        origin.offset(along, inches(length_mm)).offset(up, height),
        origin.offset(up, height)
      ]
      face = entities.add_face(outer)
      raise Error, "无法创建墙面 #{wall['uuid']}" unless face

      Array(wall['openings']).each do |opening|
        cut_opening(entities, face, origin, along, up, opening)
      end
      face.pushpull(thickness)
      entities.parent
    end

    def cut_opening(entities, outer_face, origin, along, up, opening)
      left = inches(opening.fetch('offsetMm'))
      width = inches(opening.fetch('widthMm'))
      sill = inches(opening.fetch('sillMm', 0))
      height = inches(opening.fetch('heightMm'))
      points = [
        origin.offset(along, left).offset(up, sill),
        origin.offset(along, left + width).offset(up, sill),
        origin.offset(along, left + width).offset(up, sill + height),
        origin.offset(along, left).offset(up, sill + height)
      ]
      edges = entities.add_edges(points + [points.first])
      opening_face = edges.flat_map(&:faces).uniq.find do |candidate|
        candidate != outer_face && candidate.vertices.length == 4 &&
          points.all? { |point| candidate.classify_point(point) != Sketchup::Face::PointOutside }
      end
      opening_face.erase! if opening_face&.valid?
    end

    def build_box(entities, width_mm:, depth_mm:, height_mm:)
      width = inches(width_mm)
      depth = inches(depth_mm)
      height = inches(height_mm)
      points = [
        [0, 0, 0], [width, 0, 0], [width, depth, 0], [0, depth, 0]
      ].map { |xyz| Geom::Point3d.new(*xyz) }
      face = entities.add_face(points)
      face.reverse! if face.normal.z.negative?
      face.pushpull(height)
      face
    end

    def transformation(position_mm, rotation_degrees = 0)
      translation = Geom::Transformation.translation(point_mm(position_mm).to_a)
      rotation = Geom::Transformation.rotation(
        Geom::Point3d.new(0, 0, 0),
        Geom::Vector3d.new(0, 0, 1),
        rotation_degrees.to_f.degrees
      )
      translation * rotation
    end
  end
end
