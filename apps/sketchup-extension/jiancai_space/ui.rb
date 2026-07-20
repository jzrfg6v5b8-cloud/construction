# frozen_string_literal: true

require 'json'
require 'tmpdir'
require 'time'

module JiancaiSpace
  module UserInterface
    module_function

    def install
      menu = UI.menu('Extensions').add_submenu('Sharkflows Space Configurator')
      menu.add_item('导入本地 JSON…') { guarded { JiancaiSpace.import_local } }
      menu.add_item('从本机桥接拉取…') { guarded { JiancaiSpace.pull_bridge } }
      menu.add_separator
      menu.add_item('导出场景、统计与 SKP…') { guarded { JiancaiSpace.export_current } }
    end

    def guarded
      yield
    rescue StandardError => e
      report_error(e)
    end

    def report_error(error)
      report = {
        time: Time.now.utc.iso8601,
        extensionVersion: JiancaiSpace::VERSION,
        sketchupVersion: (Sketchup.version if defined?(Sketchup)),
        rubyVersion: RUBY_VERSION,
        errorClass: error.class.name,
        message: error.message,
        validationIssues: (error.issues if error.respond_to?(:issues)),
        backtrace: Array(error.backtrace).first(30)
      }
      path = File.join(Dir.tmpdir, "sharkflows-space-error-#{Time.now.to_i}.json")
      File.write(path, JSON.pretty_generate(report))
      UI.messagebox("操作失败：#{error.message}\n\n错误报告：#{path}")
      path
    rescue StandardError
      UI.messagebox("操作失败：#{error.message}")
    end
  end
end
