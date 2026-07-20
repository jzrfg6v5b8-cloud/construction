# JSON 导入约定

## 包装结构

每次导入必须包含：

```json
{
  "schemaVersion": "1.0",
  "projectId": "A03023",
  "schemeId": "S01",
  "revision": "R03",
  "exportedAt": "2026-07-20T06:30:00Z",
  "units": "millimeters",
  "coordinateSystem": {"up": "Z", "handedness": "right", "origin": "project"},
  "objects": [{
    "id": "obj-sofa-001",
    "kind": "component",
    "sku": "SF-SOFA-2400-GR",
    "libraryVersion": "2026.07",
    "transform": {
      "translation": [3240, 5180, 0],
      "rotationDegrees": [0, 0, 0],
      "scale": [1, 1, 1]
    },
    "dimensions": {"width": 2400, "depth": 980, "height": 720},
    "roomId": "living",
    "quantity": 1
  }],
  "resources": [{
    "id": "cmp-sofa-2400",
    "relativePath": "components/SF-SOFA-2400-GR.skp",
    "sha256": "REPLACE_WITH_ACTUAL_SHA256"
  }]
}
```

## 校验门禁

导入器应先完整读取到内存上限内，再校验 UTF-8、JSON 语法、受支持 schema、必填字段、枚举、有限数值、唯一稳定 ID、资源哈希和路径。拒绝：

- `NaN`、无穷值、负尺寸、零比例、超限对象数量或文件大小；
- 绝对路径、`..` 路径穿越、符号链接逃逸、网络路径和非白名单扩展名；
- 重复 ID、未知单位、非法变换、未声明资源或哈希不匹配；
- 项目/方案与当前模型不一致，或比当前修订更旧且未显式进入回滚流程。

未知字段默认警告并保留原始导入摘要；未知必需语义必须阻断，不能猜测。

## 两阶段导入

1. **预检/计划**：不修改模型，展示新增、更新、删除、冲突、缺失 SKU、资源和尺寸差异；
2. **确认/应用**：用户确认后，在单个 SketchUp operation 内按稳定 ID 幂等写入。

删除默认采用“待删除”建议，不立即删掉用户创建的实体。若同一对象自上次同步后在源端和模型端都变化，标为冲突，要求选择保留本地、采用源端或复制为新对象。

## 结果回执

回执记录 operation ID、输入 SHA-256、schema/插件/组件库版本、计数、警告、错误和应用时间；不得包含访问令牌。成功后重新统计模型，不直接复用输入中的 SKU 数量。

JSON 导入只更新 SketchUp 模型。LayOut 仍需用户打开 `.layout`、刷新 `.skp` 引用、检查关联尺寸并点击 PDF 导出。
