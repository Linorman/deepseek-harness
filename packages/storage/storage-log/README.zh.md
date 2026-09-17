# Storage Log

[English](README.md) | 中文

`@clocky/clocky-storage-log` 挂载带路由的 `ctx.storage.log` 数据形式和可注入的 `ctx.storageLog` facility。消费方通过 `defineLogStream({ name, version })` 声明一个流，列出仍归活动路由表所有的已物化流，打开一个句柄，使用预期尾序列追加完整批次，分页读取持久记录，保存单调递增的投影检查点，并且只在准确的后续 checkpoint 保护下 compact obsolete prefix。从已 compact prefix 之前读取会明确返回 `compacted`，不会返回误导性的 gap。所选后端负责原子性和恢复；JSON 与 SQLite 都实现了日志分面。

`backend` 为必填项。`routes` 可按流选择具名后端；只有自身路由键会覆盖默认值，因此 `constructor`、`team/<id>` 和 `channel/<id>` 等不透明名称仍然安全。未知后端或没有日志分面的后端会在消费方打开流时失败。返回的句柄归调用方所有，必须在其投影或运行时结束时关闭。插件卸载时会关闭准入、排空已接受的 open、结算所有返回句柄，随后卸载数据形式；只有所有自有句柄结算后才报告聚合清理失败。

`append(expectedTail, values, { summary })`将 consumer 投影与完整批次原子提交。不提供 summary 的追加会清除旧投影。`readSummary(descriptor, maxBytes)`不打开 stream 或验证历史，只读取有界的当前 tail 元数据；stream 或摘要不存在时返回`undefined`。不支持此能力的后端拒绝摘要读写。

`scanNames({ prefix, afterCursor?, limit })` 限制实际目录/索引工作量，不调用完整 `list()`。`maxScanEntries`、`maxOpenScans`、`maxScanNameBytes` 和 `scanIdleMs` 分别限制每页工作、驻留 iterator/retry page、名称字节数和空闲 cursor 有效期。Cursor 属于单次扫描，不是持久排序或权限；空页也可能继续。过期返回 `scan-expired`。卸载会关闭所有驻留 iterator，清理失败不释放 slot。`hasStream(name)` 只精确检查元数据是否存在，不加载 value。

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
