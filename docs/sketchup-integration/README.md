# SketchUp / LayOut 集成

本目录定义从结构化方案 JSON 到 SketchUp 模型，再到人工完成 LayOut 交付的受控流程。

## 能力边界

插件可在 SketchUp 内读取经校验的 JSON，创建/更新组与组件、写入属性字典、建立命名场景、输出 SKU 统计和 handoff manifest。它不能代替设计师确认尺寸、碰撞、材质、施工可行性或审批状态。

**SketchUp Ruby API 不能直接自动化 LayOut 文档完成所有引用刷新、关联尺寸复核和导出。**最终必须由用户：

1. 打开指定 `.layout` 并刷新 `.skp` 模型引用；
2. 检查引用、场景、比例和所有关联尺寸；
3. 点击 LayOut 的 PDF 导出并核对结果。

预先固定相对路径、场景名、页面/比例约定和检查清单，可以把操作减少到这三步；这不是“自动 PDF”。仓库不包含二进制 `.layout` 模板。

## 文档导航

- [安装与使用](installation-and-usage.md)
- [插件开发](development.md)
- [JSON 导入约定](json-import.md)
- [本地桥接安全](bridge-security.md)
- [同步与版本更新](sync-updates.md)
- [组件库与 SKU 统计](component-library-and-sku.md)
- [错误恢复](error-recovery.md)
- [验收演示](acceptance-demo.md)
- [疑难排查](troubleshooting.md)
- [LayOut 模板约定](../../templates/layout/README.md)

## 推荐状态流

`EXPORTED → VALIDATED → IMPORTED_DRAFT → REVIEWED_IN_SKETCHUP → HANDOFF_READY → LAYOUT_MANUALLY_CHECKED → EXPORTED_PDF`

任何哈希、方案版本、单位、未绑定 SKU 或 blocking 尺寸异常不通过，都不得进入下一状态。同步采取显式预检、预览差异、人工确认、单事务应用和可回滚快照，禁止后台静默覆盖。
