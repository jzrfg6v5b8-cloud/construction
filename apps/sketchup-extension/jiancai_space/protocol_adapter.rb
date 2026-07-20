# frozen_string_literal: true

module JiancaiSpace
  # Converts the public SpaceConfiguration 1.0 protocol into the extension's
  # small internal modeling records. This keeps the public contract reusable by
  # future Revit integrations.
  module ProtocolAdapter
    module_function

    def normalize(document)
      openings_by_host = Array(document['openings']).group_by { |item| item['hostObjectId'] }
      fixed_room_ids = Array(document['fixedZones']).select { |zone| zone['locked'] }.map { |zone| zone['roomId'] }

      walls = Array(document['walls']).map do |wall|
        wall_record(wall, openings_by_host[wall['objectId']], lightweight: false)
      end
      walls.concat(Array(document['partitions']).map do |wall|
        wall_record(wall, openings_by_host[wall['objectId']], lightweight: true)
      end)

      objects = Array(document['products']).map do |product|
        {
          'uuid' => product.fetch('objectId'),
          'componentType' => product.fetch('componentDefinition'),
          'name' => product['sku'],
          'sku' => product.fetch('sku'),
          'materialId' => product.fetch('materialCode'),
          'roomId' => product.fetch('roomId'),
          'dimensions' => {
            'widthMm' => product.fetch('widthMm'),
            'depthMm' => product.fetch('depthMm'),
            'heightMm' => product.fetch('heightMm')
          },
          'positionMm' => [product.fetch('xMm'), product.fetch('yMm'), product.fetch('zMm')],
          'rotationDeg' => product.fetch('rotationDegrees'),
          'quantity' => product.fetch('quantity'),
          'verificationStatus' => product.fetch('verificationStatus'),
          'fixed' => fixed_room_ids.include?(product['roomId'])
        }
      end
      objects.concat(door_records(document))

      {
        'schemaVersion' => document.fetch('schemaVersion'),
        'projectId' => document.fetch('projectId'),
        'geometryVersion' => document.fetch('geometryVersion'),
        'dimensionsVerified' => document.fetch('dimensionsVerified'),
        'walls' => walls,
        'objects' => objects,
        'materials' => Array(document['materials']).map do |material|
          {
            'id' => material.fetch('materialCode'),
            'name' => material.fetch('name'),
            'color' => material.fetch('colorHex')
          }
        end,
        'cameras' => document['cameras'],
        'dimensionAnnotations' => document['dimensionAnnotations'],
        'outputRequirements' => document['outputRequirements']
      }
    end

    def wall_record(wall, openings, lightweight:)
      {
        'uuid' => wall.fetch('objectId'),
        'name' => lightweight ? '新增轻质隔墙' : "#{wall['wallType']} wall",
        'startMm' => point(wall.fetch('start')),
        'endMm' => point(wall.fetch('end')),
        'thicknessMm' => wall.fetch('thicknessMm'),
        'heightMm' => wall.fetch('heightMm'),
        'openings' => Array(openings).map do |opening|
          {
            'uuid' => opening.fetch('objectId'),
            'offsetMm' => opening.fetch('offsetMm'),
            'widthMm' => opening.fetch('widthMm'),
            'heightMm' => opening.fetch('heightMm'),
            'sillMm' => opening.fetch('sillHeightMm')
          }
        end,
        'exterior' => wall['wallType'] == 'EXTERIOR',
        'lightweight' => lightweight,
        'fixed' => wall['locked'],
        'locked' => wall['locked'],
        'verificationStatus' => wall.fetch('verificationStatus')
      }
    end

    def door_records(document)
      walls = (Array(document['walls']) + Array(document['partitions'])).to_h { |wall| [wall['objectId'], wall] }
      Array(document['doors']).map do |door|
        wall = walls.fetch(door.fetch('hostObjectId'))
        start = wall.fetch('start')
        finish = wall.fetch('end')
        dx = finish.fetch('xMm') - start.fetch('xMm')
        dy = finish.fetch('yMm') - start.fetch('yMm')
        length = Math.hypot(dx, dy)
        offset = door.fetch('offsetMm')
        {
          'uuid' => door.fetch('objectId'),
          'componentType' => door.fetch('componentDefinition'),
          'name' => '门',
          'sku' => "DOOR-#{door.fetch('componentDefinition')}",
          'dimensions' => {
            'widthMm' => door.fetch('widthMm'),
            'depthMm' => door.fetch('depthMm'),
            'heightMm' => door.fetch('heightMm')
          },
          'positionMm' => [
            start.fetch('xMm') + (dx / length * offset),
            start.fetch('yMm') + (dy / length * offset),
            start.fetch('zMm')
          ],
          'rotationDeg' => Math.atan2(dy, dx) * 180.0 / Math::PI,
          'verificationStatus' => door.fetch('verificationStatus'),
          'fixed' => door['locked']
        }
      end
    end

    def point(value)
      [value.fetch('xMm'), value.fetch('yMm'), value.fetch('zMm')]
    end
  end
end
