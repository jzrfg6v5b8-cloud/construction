# Sharkflows SketchUp Ruby Extension

真实的 SketchUp Ruby API 扩展。`jiancai_space.rb` 是注册入口，业务代码位于
`jiancai_space/`。打包时将这两项放入同一个 RBZ 根目录。

## 安装与使用

1. 将 `jiancai_space.rb` 与 `jiancai_space/` 打成 zip 并改名为 `.rbz`。
2. 在 SketchUp 2021+ 的扩展管理器中安装。
3. 通过“扩展程序 → Sharkflows Space Configurator”导入 JSON，或从
   `http://127.0.0.1:<port>` 主动拉取任务。桥接 token 仅作为
   `Authorization: Bearer <token>` 请求头发送，不会持久化。
4. 导出会生成统计 JSON、8 个场景 PNG、SKP 副本和 LayOut handoff manifest。

## 输入约定

输入必须通过 `packages/space-schema` 的 `SpaceConfiguration` JSON Schema。
长度一律为毫米。墙体、隔墙、洞口、门窗和产品使用稳定RFC 4122 UUID。产品必须
包含 `objectId`、`sku`、`componentDefinition`、宽深高、XYZ坐标、旋转角、
`materialCode`、数量、房间及 `verificationStatus`。扩展内部会转换为精简建模记录，
但不会改变或另建一套公共协议。

同步以 UUID upsert。墙组会在原组内重建几何，组件实例会替换definition和transform，
而不是叠加重复实例。只有attribute dictionary中 `projectId` 与当前项目一致的旧对象
才会删除；跨项目UUID冲突会中止整个SketchUp operation。外墙、固定区域和厨卫设备
会锁定，轻质墙进入 `JS_轻质隔墙` tag。已标记 `VERIFIED` 的模型对象拒绝被低置信度
或未审核尺寸覆盖。

## 组件与尺寸

`jiancai_space/components/manifest.json` 定义 12 种组件及真实毫米默认值、最小值
和最大值。仓库不包含二进制厂家 SKP。若同名 SKP 资产不存在，Ruby 会按目标尺寸
重建几何占位组件，并写入 `placeholder=true`。这不是 Dynamic Components；
代码从不对实例应用非等比缩放。若以后提供二进制 SKP，仅在请求尺寸等于 manifest
默认尺寸时原样加载，其他尺寸仍由 Ruby 重建。

## 无 SketchUp 测试

```sh
ruby -Itest test/pure_logic_test.rb
```

纯逻辑通过 `defined?(Sketchup)` 与宿主隔离；几何、页面、图片和 SKP 保存必须在
真实 SketchUp 中做集成验证。

## 真实限制

- 洞口使用 SketchUp face loop + `pushpull` 构建，适用于直线、垂直、矩形墙体；
  不处理曲墙、斜墙、布尔相交或异形洞口。
- 占位组件表达包络尺寸，不是厂家造型、碰撞模型或施工深化模型。
- 材料支持颜色、透明度和属性；manifest 未提供纹理二进制，因此不生成纹理贴图。
- LayOut 仅输出 handoff manifest，扩展不启动、脚本化或控制 LayOut。
- Minitest 不伪造 SketchUp API；需在 SketchUp 内人工确认图形结果和 PNG 渲染。
