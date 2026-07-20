# 插件开发

## 结构建议

```text
sharkflows_loader.rb             # 仅注册扩展
sharkflows/
  extension.rb                   # 菜单、工具栏、生命周期
  import/validator.rb            # schema、单位、引用校验
  import/planner.rb              # 生成无副作用差异计划
  import/apply.rb                # 单事务修改模型
  sync/client.rb                 # 可选本地桥接客户端
  catalog/resolver.rb            # 组件/SKU 解析
  export/handoff.rb              # 统计与 manifest
  ui/                            # HtmlDialog 静态资源
```

顶层命名空间必须唯一；加载器避免重复注册。业务逻辑与 SketchUp API 适配层分离，解析/校验使用固定 fixture 单元测试，模型写入使用最小集成样例测试。

## SketchUp API 约束

- 所有模型变更包在 `model.start_operation(name, true)` 与 `commit_operation` 中；异常时 `abort_operation`，让用户可一次撤销。
- 不在后台线程调用 SketchUp 模型 API。网络/文件解析完成后，通过受支持的 UI 调度回主线程应用结果。
- 长任务分批并提供取消点；取消只能发生在安全边界，不留下半写属性。
- 长度先按 JSON 单位显式转换；禁止把无单位数值猜成毫米。
- 将稳定 ID、SKU、源版本、资源哈希写入自有属性字典，不依赖实体持久 ID 跨文件永远不变。
- 不执行 JSON 中的 Ruby、路径命令、URL 或任意脚本；HTML 对话框内容需转义。

## 开发安装与调试

开发版通过受控脚本把加载器和插件目录链接/复制到当前 SketchUp 版本的 Plugins 目录；发布包则生成 `.rbz`。不要硬编码不同系统的用户目录。启动时记录插件版本、SketchUp 版本、schema 版本和相关操作 ID，但不记录令牌、完整客户 JSON 或文件内容。

准备三类 fixture：最小合法、含全部可选字段、故意非法/超限。至少测试：

- schema 版本、未知字段、重复稳定 ID、单位与矩阵；
- 路径穿越、超大文件、哈希不匹配、桥接重放；
- 重复导入幂等性、用户本地修改冲突、撤销/恢复；
- 组件替换、SKU 聚合、场景命名和 manifest 确定性。

## 发布

发布物应有版本号、变更记录、支持矩阵、SHA-256 和回滚包。正式项目首次打开新版前先复制 `.skp`。插件版本、JSON schema 版本和组件库版本独立演进，兼容范围必须显式声明。

## 不应实现的承诺

SketchUp Ruby 扩展可准备 `.skp`、场景和交接数据，但不能直接控制 LayOut 完成全部引用刷新、关联尺寸检查和 PDF 导出。开发验收不得用“自动 LayOut”或“自动最终 PDF”作为成功标准。
