# A03023 交付示例

这是目录结构和 handoff manifest 示例，不是可直接打开的交付包。仓库不含 `.skp`、`.layout`、客户资料或自动生成的 PDF。

## 放置资源

- `assets/models/A03023_S01_model_R03_20260720.skp`：经插件导入、人工检查并保存的模型；
- `A03023_S01_layout_R03_20260720.layout`：由团队在 LayOut 2026 中基于约定人工创建的文档；
- `assets/references/verified-dimensions.pdf`：已审核尺寸来源；
- `assets/references/sku-register.csv`：批准的 SKU 台账；
- `exports/`：用户从 LayOut 点击导出的 PDF；
- `handoff-manifest.json`：场景、版本、资源哈希、SKU 统计及人工门禁。

`models`、`references` 和 `exports` 中不得提交真实客户资料到公共仓库。交付前用实际 SHA-256 替换占位符；哈希不一致时停止使用，不要静默重连同名文件。

## 三步完成

1. 打开 `A03023_S01_layout_R03_20260720.layout`，在 LayOut 文档引用中刷新 manifest 指定的 `.skp`；
2. 检查引用状态、场景名、固定比例和每一条关联尺寸，对照复尺资料签署清单；
3. 用户点击 PDF 导出到 `exports/`，核对页数、修订号、DRAFT 水印和文件名。

SketchUp Ruby API 只能帮助准备 SketchUp 模型、场景、属性和 manifest，不能直接让 LayOut 完成全部引用刷新、关联尺寸复核和 PDF 导出。

## 当前示例门禁

manifest 故意保留一个未绑定 SKU，并将 LayOut 检查项设为 `false`，因此只能视为 DRAFT。不得把示例占位哈希、计数或审批状态当作真实项目事实。
