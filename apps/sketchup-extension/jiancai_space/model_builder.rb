# frozen_string_literal: true

require 'json'
require_relative 'geometry'
require_relative 'component_library'

module JiancaiSpace
  class ModelBuilder
    DICTIONARY = 'JiancaiSpace'.freeze

    def initialize(component_library: ComponentLibrary.new)
      @component_library = component_library
    end

    def build(model, document)
      project_id = document.fetch('projectId')
      records = Array(document['walls']) + Array(document['objects'])
      incoming_ids = records.map { |record| record.fetch('uuid') }
      current = indexed_entities(model)
      assert_no_cross_project_collision!(current, records, project_id)
      assert_no_verified_downgrade!(current, records)

      model.start_operation('同步建材商空间', true)
      begin
        materials = build_materials(model, Array(document['materials']))
        records.each do |record|
          record = record.merge('projectId' => project_id, 'locked' => locked_record?(record))
          entity = if wall_record?(record)
                     upsert_wall(model, record, current[record['uuid']])
                   else
                     @component_library.upsert_instance(model, record, current[record['uuid']])
                   end
          apply_material(entity, materials[record['materialId']])
        end
        delete_stale(current, incoming_ids, project_id)
        model.set_attribute(DICTIONARY, 'projectId', project_id)
        model.set_attribute(DICTIONARY, 'schemaVersion', document.fetch('schemaVersion', 1))
        model.set_attribute(DICTIONARY, 'geometryVersion', document['geometryVersion'])
        model.commit_operation
      rescue StandardError
        model.abort_operation
        raise
      end
      model
    end

    private

    def indexed_entities(model)
      model.entities.each_with_object({}) do |entity, memo|
        uuid = entity.get_attribute(DICTIONARY, 'uuid')
        memo[uuid] = entity if uuid
      end
    end

    def assert_no_cross_project_collision!(current, records, project_id)
      records.each do |record|
        entity = current[record['uuid']]
        next unless entity
        owner = entity.get_attribute(DICTIONARY, 'projectId')
        next if owner == project_id

        raise ProjectConflictError,
              "UUID #{record['uuid']} 已属于项目 #{owner.inspect}，拒绝覆盖"
      end
    end

    def delete_stale(current, incoming_ids, project_id)
      current.each do |uuid, entity|
        next if incoming_ids.include?(uuid)
        next unless entity.get_attribute(DICTIONARY, 'projectId') == project_id

        entity.erase! if entity.valid?
      end
    end

    def assert_no_verified_downgrade!(current, records)
      records.each do |record|
        entity = current[record['uuid']]
        next unless entity
        previous = entity.get_attribute(DICTIONARY, 'verificationStatus')
        incoming = record['verificationStatus']
        next unless previous == 'VERIFIED' && incoming != 'VERIFIED'

        raise ValidationError,
              "对象 #{record['uuid']} 已使用审核尺寸，拒绝由 #{incoming || 'UNVERIFIED'} 数据覆盖"
      end
    end

    def wall_record?(record)
      record.key?('startMm') && record.key?('endMm')
    end

    def build_wall(model, wall)
      group = model.entities.add_group
      group.name = wall['name'] || "墙体 #{wall['uuid']}"
      Geometry.build_wall(group.entities, wall)
      wall_attributes = {
        'uuid' => wall['uuid'],
        'projectId' => wall['projectId'],
        'objectType' => 'wall',
        'sku' => wall['sku'],
        'materialId' => wall['materialId'],
        'heightMm' => wall['heightMm'],
        'thicknessMm' => wall['thicknessMm'],
        'lightweight' => !!wall['lightweight'],
        'locked' => !!wall['locked']
      }
      wall_attributes.each { |key, value| group.set_attribute(DICTIONARY, key, value) unless value.nil? }
      if wall['lightweight']
        tag = model.layers['JS_轻质隔墙'] || model.layers.add('JS_轻质隔墙')
        group.layer = tag
      end
      group.locked = !!wall['locked']
      group
    end

    def upsert_wall(model, wall, existing)
      if existing&.valid? && existing.respond_to?(:entities)
        existing.locked = false
        existing.entities.clear!
        Geometry.build_wall(existing.entities, wall)
        group = existing
      else
        group = build_wall(model, wall)
      end
      group.name = wall['name'] || "墙体 #{wall['uuid']}"
      {
        'uuid' => wall['uuid'],
        'projectId' => wall['projectId'],
        'objectType' => 'wall',
        'materialId' => wall['materialId'],
        'heightMm' => wall['heightMm'],
        'thicknessMm' => wall['thicknessMm'],
        'lightweight' => !!wall['lightweight'],
        'locked' => !!wall['locked'],
        'verificationStatus' => wall['verificationStatus']
      }.each { |key, value| group.set_attribute(DICTIONARY, key, value) unless value.nil? }
      group.locked = !!wall['locked']
      group
    end

    def locked_record?(record)
      room_type = (record['roomType'] || record['spaceType']).to_s.downcase
      record['exterior'] || record['wetArea'] || record['fixed'] ||
        %w[kitchen bathroom 厨房 卫生间 厨卫].include?(room_type)
    end

    def build_materials(model, definitions)
      definitions.each_with_object({}) do |source, memo|
        id = source['id'].to_s
        next if id.empty?
        material = model.materials["JS_#{id}"] || model.materials.add("JS_#{id}")
        material.color = Sketchup::Color.new(*color_components(source.fetch('color', '#CCCCCC')))
        material.set_attribute(DICTIONARY, 'displayName', source['name']) if source['name']
        material.alpha = source['alpha'].to_f if source.key?('alpha')
        material.set_attribute(DICTIONARY, 'materialId', id)
        material.set_attribute(DICTIONARY, 'sku', source['sku']) if source['sku']
        memo[id] = material
      end
    end

    def color_components(value)
      return value.first(3).map { |channel| Integer(channel).clamp(0, 255) } if value.is_a?(Array) && value.length >= 3
      match = /\A#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})\z/i.match(value.to_s)
      raise ValidationError, "材料颜色无效: #{value.inspect}" unless match

      match.captures.map { |hex| hex.to_i(16) }
    end

    def apply_material(entity, material)
      return unless material
      entity.material = material if entity.respond_to?(:material=)
      entity.definition.entities.grep(Sketchup::Face).each { |face| face.material = material } if entity.respond_to?(:definition)
      entity.entities.grep(Sketchup::Face).each { |face| face.material = material } if entity.respond_to?(:entities)
    end
  end
end
