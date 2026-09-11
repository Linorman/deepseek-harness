# Storage Log

[English](README.md) | 中文

`@clocky/clocky-storage-log` 挂载带路由的 `ctx.storage.log` 数据形式和可注入的 `ctx.storageLog` facility。消费方通过 `defineLogStream({ name, version })` 声明一个流，列出仍归活动路由表所有的已物化流，打开一个句柄，使用预期尾序列追加完整批次，分页读取持久记录，保存单调递增的投影检查点，并且只在准确的后续 checkpoint 保护下 compact obsolete prefix。从已 compact prefix 之前读取会明确返回 `compacted`，不会返回误导性的 gap。所选后端负责原子性和恢复；JSON 与 SQLite 都实现了日志分面。

`backend` 为必填项。`routes` 可按流选择具名后端；只有自身路由键会覆盖默认值，因此 `constructor`、`team/<id>` 和 `channel/<id>` 等不透明名称仍然安全。未知后端或没有日志分面的后端会在消费方打开流时失败。返回的句柄归调用方所有，必须在其投影或运行时结束时关闭。插件卸载时会关闭准入、排空已接受的 open、结算所有返回句柄，随后卸载数据形式；只有所有自有句柄结算后才报告聚合清理失败。

## Model Experience

### Request context and condition

#### What the model sees

`ctx.storage.log` 是主机侧数据形式，不公开提示词片段、工具或模型可见事件。

#### Token effect

没有直接 token 影响。

#### KV Cache effect

本包不拥有模型请求或提示词前缀。

## Known Limitations and Deferred Work

- **没有 Team 专用语义**——[`@clocky/clocky-team-hub`](../../team/team-hub/README.zh.md)拥有 Team 和 channel 格式、投影与恢复；本数据形式只路由其持久流。投递和调度仍在两个包之外。
