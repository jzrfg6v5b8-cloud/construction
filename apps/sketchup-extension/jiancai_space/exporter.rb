# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'digest'

module JiancaiSpace
  class Exporter
    DICTIONARY = 'JiancaiSpace'.freeze

    def statistics(document)
      walls = Array(document['walls'])
      objects = Array(document['objects'])
      {
        'projectId' => document['projectId'],
        'geometryVersion' => document['geometryVersion'],
        'wallCount' => walls.length,
        'openingCount' => walls.sum { |wall| Array(wall['openings']).length },
        'componentCount' => objects.length,
        'componentsByType' => objects.group_by { |item| item['componentType'] }.transform_values(&:length),
        'materialCount' => Array(document['materials']).length,
        'lightweightWallCount' => walls.count { |wall| wall['lightweight'] },
        'lockedObjectCount' => walls.count { |wall| wall['exterior'] || wall['wetArea'] || wall['fixed'] } +
          objects.count { |object| object['fixed'] },
        'components' => component_statistics(objects)
      }
    end

    def export(model, document, output_dir)
      raise Error, '未选择导出目录' if output_dir.to_s.empty?
      FileUtils.mkdir_p(output_dir)
      project_id = safe_name(document.fetch('projectId'))
      stats_path = File.join(output_dir, "#{project_id}-statistics.json")
      File.write(stats_path, JSON.pretty_generate(statistics(document)))

      image_paths = model.pages.map do |page|
        model.pages.selected_page = page
        model.active_view.refresh
        path = File.join(output_dir, "#{project_id}-#{safe_name(page.name)}.png")
        model.active_view.write_image(
          filename: path, width: 2400, height: 1600,
          antialias: true, transparent: false
        )
        path
      end

      skp_path = File.join(output_dir, "#{project_id}.skp")
      raise Error, 'SketchUp 另存失败' unless model.save_copy(skp_path)

      handoff_path = File.join(output_dir, "#{project_id}-layout-handoff.json")
      exports = [skp_path, stats_path, *image_paths].map { |path| file_metadata(path) }
      File.write(handoff_path, JSON.pretty_generate(
        'kind' => 'layout-handoff-manifest',
        'projectId' => document['projectId'],
        'geometryVersion' => document['geometryVersion'],
        'skp' => File.basename(skp_path),
        'scenes' => model.pages.map(&:name),
        'images' => image_paths.map { |path| File.basename(path) },
        'statistics' => File.basename(stats_path),
        'exports' => exports,
        'layoutAutomation' => false,
        'layoutSteps' => ['打开指定.layout模板', '刷新SketchUp模型引用并检查关联尺寸', '点击导出PDF或PNG'],
        'note' => '供人工在 LayOut 中引用；SketchUp Ruby Extension不控制LayOut。'
      ))
      {
        skp: skp_path,
        statistics: stats_path,
        images: image_paths,
        handoff: handoff_path,
        manifest: handoff_path,
        component_summary: {
          total: Array(document['objects']).sum { |object| object.fetch('quantity', 1).to_i },
          succeeded: Array(document['objects']).sum { |object| object.fetch('quantity', 1).to_i },
          failed: 0,
          skipped: 0,
          byType: Array(document['objects']).group_by { |item| item['componentType'] }
            .transform_values { |items| items.sum { |item| item.fetch('quantity', 1).to_i } },
          skuCounts: Array(document['objects']).group_by { |item| item['sku'] }
            .transform_values { |items| items.sum { |item| item.fetch('quantity', 1).to_i } }
        }
      }
    end

    private

    def safe_name(value)
      value.to_s.gsub(/[^0-9A-Za-z\u4e00-\u9fff_.-]+/, '_')
    end

    def component_statistics(objects)
      objects.group_by do |object|
        dimensions = object.fetch('dimensions', {})
        [object['sku'], object['componentType'], dimensions['widthMm'], dimensions['depthMm'],
         dimensions['heightMm'], object['materialId'], object['roomId']]
      end.map do |key, items|
        sku, name, width, depth, height, material, room = key
        {
          'sku' => sku,
          'componentName' => name,
          'quantity' => items.sum { |item| item.fetch('quantity', 1).to_i },
          'widthMm' => width,
          'depthMm' => depth,
          'heightMm' => height,
          'materialCode' => material,
          'roomId' => room,
          'modelObjectIds' => items.map { |item| item['uuid'] }
        }
      end
    end

    def file_metadata(path)
      {
        'filename' => File.basename(path),
        'sizeBytes' => File.size(path),
        'sha256' => Digest::SHA256.file(path).hexdigest
      }
    end
  end
end
