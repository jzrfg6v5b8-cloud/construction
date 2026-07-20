# frozen_string_literal: true

require_relative 'test_helper'
require 'json'
require 'validator'
require 'importer'
require 'protocol_adapter'
require 'bridge_client'
require 'component_library'
require 'exporter'
require 'geometry'

class PureLogicTest < Minitest::Test
  def valid_document
    path = File.expand_path('../../../packages/space-schema/examples/A03023.json', __dir__)
    JSON.parse(File.read(path))
  end

  def test_validates_public_space_configuration
    document = JiancaiSpace::Validator.new.validate!(valid_document)
    assert_equal 'A03023', document['projectId']
    assert_equal 'gv-0003', document['geometryVersion']
  end

  def test_rejects_opening_outside_wall
    document = valid_document
    document['openings'][0]['offsetMm'] = 6300
    error = assert_raises(JiancaiSpace::ValidationError) do
      JiancaiSpace::Validator.new.validate!(document)
    end
    assert_includes error.message, '超出墙体长度'
  end

  def test_importer_normalizes_protocol_without_sketchup
    parsed = JiancaiSpace::Importer.new.parse(JSON.generate(valid_document))
    assert_equal valid_document['walls'].length + valid_document['partitions'].length, parsed['walls'].length
    assert_equal valid_document['products'].length + valid_document['doors'].length, parsed['objects'].length
    assert_equal 'SF-SOFA-2200', parsed['objects'].first['sku']
    refute defined?(Sketchup)
  end

  def test_millimeter_conversion
    assert_in_delta 1.0, JiancaiSpace::Geometry.inches(25.4), 0.000001
  end

  def test_component_constraints
    library = JiancaiSpace::ComponentLibrary.new
    dimensions = library.constrain('bed-single', 'widthMm' => 1000)
    assert_equal 1000.0, dimensions['width']
    assert_raises(JiancaiSpace::ComponentError) do
      library.constrain('bed-single', 'widthMm' => 2000)
    end
  end

  def test_component_manifest_covers_requested_twelve_components
    path = File.expand_path('../jiancai_space/components/manifest.json', __dir__)
    manifest = JSON.parse(File.read(path))
    assert_equal 12, manifest['components'].length
    assert_equal false, manifest['binaryAssetsIncluded']
    assert_includes manifest['components'].map { |item| item['type'] }, 'folding-dining-table'
    assert_includes manifest['components'].map { |item| item['type'] }, 'bathroom-fixture-placeholder'
  end

  def test_rejects_arbitrary_component_scaling
    document = valid_document
    document['products'][0]['scaleX'] = 2
    error = assert_raises(JiancaiSpace::ValidationError) do
      JiancaiSpace::Validator.new.validate!(document)
    end
    assert_includes error.message, '禁止任意非等比缩放'
  end

  def test_rejects_unverified_floorplan
    document = valid_document
    document['dimensionsVerified'] = false
    assert_raises(JiancaiSpace::ValidationError) { JiancaiSpace::Validator.new.validate!(document) }
  end

  def test_bridge_rejects_non_loopback
    assert_raises(JiancaiSpace::BridgeError) do
      JiancaiSpace::BridgeClient.new(url: 'http://localhost:1234', token: 'secret')
    end
  end

  def test_statistics_contains_sku_dimensions_and_model_ids
    normalized = JiancaiSpace::ProtocolAdapter.normalize(valid_document)
    statistics = JiancaiSpace::Exporter.new.statistics(normalized)
    assert_equal valid_document['walls'].length + valid_document['partitions'].length, statistics['wallCount']
    sofa = statistics['components'].find { |item| item['sku'] == 'SF-SOFA-2200' }
    assert_equal 2200, sofa['widthMm']
    assert_equal 1, sofa['quantity']
    assert_equal 1, sofa['modelObjectIds'].length
  end
end
