# frozen_string_literal: true

require 'net/http'
require 'uri'
require 'json'
require 'base64'
require_relative 'errors'
require_relative 'version'

module JiancaiSpace
  class BridgeClient
    LOOPBACK = '127.0.0.1'

    def initialize(url:, token:, open_timeout: 3, read_timeout: 30)
      @uri = URI.parse(url)
      @token = token.to_s
      @open_timeout = open_timeout
      @read_timeout = read_timeout
      validate_configuration!
    rescue URI::InvalidURIError => e
      raise BridgeError, "桥接地址无效: #{e.message}"
    end

    def status
      request_json(:get, '/v1/status')
    end

    def pull_next
      response = request(:get, '/v1/plugin/tasks/next?waitMs=0')
      return nil if response.code.to_i == 204

      parse_success(response)
    end

    def update(task_id, status:, progress:, error: nil, versions: nil, components: nil)
      payload = { status: status, progress: progress }
      payload[:error] = error if error
      payload[:versions] = versions if versions
      payload[:components] = components if components
      request_json(:patch, "/v1/plugin/tasks/#{task_id}", payload)
    end

    def upload_result(task_id, path, content_type, final: true)
      raise BridgeError, "导出文件不存在: #{path}" unless File.file?(path)

      request_json(
        :post,
        "/v1/plugin/tasks/#{task_id}/result",
        {
          filename: File.basename(path),
          contentType: content_type,
          dataBase64: Base64.strict_encode64(File.binread(path)),
          final: final
        }
      )
    end

    private

    def request_json(method, path, body = nil)
      parse_success(request(method, path, body))
    end

    def request(method, path, body = nil)
      target = URI.join("#{@uri}/", path.sub(%r{\A/}, ''))
      klass = { get: Net::HTTP::Get, post: Net::HTTP::Post, patch: Net::HTTP::Patch }.fetch(method)
      request = klass.new(target.request_uri)
      request['Authorization'] = "Bearer #{@token}"
      request['Accept'] = 'application/json'
      request['User-Agent'] = "Sharkflows-SketchUp/#{JiancaiSpace::VERSION}"
      if body
        request['Content-Type'] = 'application/json'
        request.body = JSON.generate(body)
      end
      Net::HTTP.start(
        target.host, target.port,
        use_ssl: false,
        open_timeout: @open_timeout,
        read_timeout: @read_timeout
      ) { |http| http.request(request) }
    rescue IOError, SystemCallError, Timeout::Error, SocketError => e
      raise BridgeError, "无法连接本机桥接: #{e.message}"
    end

    def parse_success(response)
      unless response.is_a?(Net::HTTPSuccess)
        raise BridgeError, "桥接返回 HTTP #{response.code}: #{response.body.to_s[0, 500]}"
      end
      return {} if response.body.to_s.empty?

      JSON.parse(response.body)
    rescue JSON::ParserError => e
      raise BridgeError, "桥接返回无效JSON: #{e.message}"
    end

    def validate_configuration!
      unless @uri.scheme == 'http' && @uri.host == LOOPBACK && @uri.port.between?(1, 65_535)
        raise BridgeError, '桥接仅允许 http://127.0.0.1:<port>'
      end
      raise BridgeError, '桥接 token 必填' if @token.empty?
      raise BridgeError, '桥接 URL 不得包含用户凭据' if @uri.user || @uri.password
    end
  end
end
