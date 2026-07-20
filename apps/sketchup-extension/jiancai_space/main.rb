# frozen_string_literal: true

require_relative 'version'
require_relative 'errors'
require_relative 'importer'
require_relative 'bridge_client'
require_relative 'model_builder'
require_relative 'dimension_builder'
require_relative 'scene_builder'
require_relative 'exporter'
require_relative 'ui'

module JiancaiSpace
  class << self
    attr_reader :last_document

    def start
      UserInterface.install
    end

    def import_local
      path = UI.openpanel('选择空间 JSON', nil, 'JSON Files|*.json||')
      return unless path

      synchronize(Importer.new.from_file(path))
    end

    def pull_bridge
      defaults = [
        Sketchup.read_default(EXTENSION_ID, 'bridge_url', 'http://127.0.0.1:43821'),
        ''
      ]
      values = UI.inputbox(['桥接 URL', '访问 token'], defaults, '从本机桥接拉取建模任务')
      return unless values

      url, token = values
      Sketchup.write_default(EXTENSION_ID, 'bridge_url', url)
      client = BridgeClient.new(url: url, token: token)
      task = client.pull_next
      unless task
        UI.messagebox('桥接队列中没有待处理任务')
        return
      end
      @bridge_client = client
      @last_task_id = task.fetch('id')
      client.update(@last_task_id, status: 'MODEL_BUILDING', progress: 20)
      synchronize(Importer.new.parse(JSON.generate(task.fetch('configuration'))))
      client.update(
        @last_task_id,
        status: 'MODEL_VALIDATING',
        progress: 75,
        versions: {
          configurationVersion: task.dig('configuration', 'geometryVersion').to_s,
          pluginVersion: VERSION,
          sketchUpVersion: Sketchup.version
        }
      )
      client.update(@last_task_id, status: 'LAYOUT_REFRESH_REQUIRED', progress: 85)
    rescue StandardError => e
      @bridge_client&.update(
        @last_task_id,
        status: 'FAILED',
        progress: 100,
        error: { code: e.class.name, message: e.message, retryable: false }
      ) if @last_task_id
      raise
    end

    def synchronize(document)
      ModelBuilder.new.build(Sketchup.active_model, document)
      DimensionBuilder.new.build(Sketchup.active_model, document['dimensionAnnotations'])
      SceneBuilder.new.build(Sketchup.active_model, document)
      @last_document = document
      UI.messagebox("同步完成：#{document['projectId']}")
      document
    end

    def export_current
      document = @last_document
      raise Error, '请先导入或拉取项目 JSON' unless document

      output_dir = UI.select_directory(title: '选择导出目录')
      return unless output_dir
      result = Exporter.new.export(Sketchup.active_model, document, output_dir)
      if @bridge_client && @last_task_id
        @bridge_client.update(
          @last_task_id,
          status: 'EXPORTING',
          progress: 90,
          components: result.fetch(:component_summary)
        )
        @bridge_client.upload_result(@last_task_id, result.fetch(:skp), 'application/vnd.sketchup', final: false)
        @bridge_client.upload_result(@last_task_id, result.fetch(:statistics), 'application/json', final: false)
        result.fetch(:images).each do |image|
          @bridge_client.upload_result(@last_task_id, image, 'image/png', final: false)
        end
        # The final handoff manifest closes the bridge task after every output
        # has been accepted and hashed.
        @bridge_client.upload_result(@last_task_id, result.fetch(:manifest), 'application/json', final: true)
      end
      UI.messagebox("导出完成：\n#{result[:skp]}")
      result
    end
  end
end
