# @clocky/clocky-storage-sqlite

`readSqliteRawLogArchive()` 在单个读事务中捕获原始流版本、sequence 与所存正文的精确字节；以 base64 逻辑记录保留 entries、checkpoint 和可选 summary，并记录物理 schema 标记。它是有界逻辑归档，不是精确数据库/WAL 物理复制，也不验证消费者状态；不需要打开当前版本 backend。

`readSqliteLogPages()` 在首次产出前开启一个读事务并捕获流尾，再逐页产出连续记录。`maxEntries`、`maxBytes` 约束整体观察；`pageEntries` 和包含完整外层结构的 `pageBytes` 约束每页。正文解码前检查大小；不可再分的超大记录以 `read-limit` 返回 `entry-bytes`、实际量与上限。之后追加的记录不进入固定前缀；消费者须读完或关闭异步迭代器以释放连接。

只读快照额度超限使用 `StorageError.code = read-limit`；无效观察配置仍为 `invalid-value`。版本不匹配和介质损坏保留各自错误码。

[English](README.md) | 中文

`readSqliteLogSnapshot(path, descriptor, limits)` 使用现有只读连接和单个读取事务，不初始化或迁移 schema、不取得 backend ownership，也不修改 journal。解码前核对 physical／stream version 以及编码 row／checkpoint 大小，再验证完整响应额度。SQLite 的只读连接仍可能创建或复用 WAL／SHM 辅助文件，这是 [SQLite WAL 语义](https://www.sqlite.org/walformat.html)，不代表应用写入已受理。并发可变 journal 不适合 immutable mode。

[存储中心](../storage/README.zh.md)的 SQLite 后端：注册为后端 `sqlite`，通过一个数据库提供 `kv` 和追加日志分面；该数据库由 `node:sqlite` 操作，可以是单个文件，也可以是 `:memory:`。设计与取舍见[领域 KV 存储 Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md)。

Log-name discovery 使用 UTF-8 prefix 范围和排他的 last-name key，每次从 stream-name 索引定位一行，不读取 log entry 或 checkpoint。当前 key 之后插入的名称可以进入本次扫描；key 之前的插入由新的扫描发现。

Log summary 列与 entry 和 tail 在同一事务更新。有界摘要读取只查询 stream 元数据行，在返回前拒绝超限 UTF-8 value，不读取 entry 或 checkpoint。物理 schema 版本为 3，旧版本数据库会被拒绝。

## 存储模型

每行一个文档：每个单元表都会成为一个物理 STRICT 表 `"u_<unit>_<table>" (key TEXT PRIMARY KEY, value TEXT)`，其中 `value` 是记录的 JSON 文本，因此一个 key 只更新一行（高频变更领域路由到这里而非 JSON 后端的原因）。单元标识位于两个元数据表中：`units` 在单元首次打开时标记其格式版本，描述符不同时以 `version-mismatch` 拒绝；`unit_globals` 保存每个单元的全局单例行。物理布局版本位于 `PRAGMA user_version`；其他任何标记值都会被拒绝（未发布格式，不迁移）。单元名和表名在进入 DDL 之前依据中心的 `UNIT_NAME_RE` 进行验证，因此不会把外部输入插值到 SQL 标识符中。

每个写入原语都是一条预处理语句：SQLite 的逐语句原子性无需显式事务即可满足 KV 约定，写入顺序仍由调用方负责（领域层写入链）。缺失目录和数据库文件会以仅所有者可访问的权限创建（`0o700`／`0o600`），与会话持久化 SQLite 后端一致。

追加日志使用 `log_streams`、`log_entries` 和 `log_checkpoints`。日志追加会打开 `BEGIN IMMEDIATE`、比较持久尾序列、插入完整批次、推进尾序列并提交；陈旧的尾序列以 `sequence-conflict` 拒绝。检查点单调递增且不能超过当前尾序列。流名称作为 SQL 绑定值而不是标识符，因此 Team 和 channel 流名称保持不透明。

## 配置（schemastery）

```ts
interface Config {
  path: string   // SQLite database file path, or ':memory:' for an in-process DB
  journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'   // journal_mode pragma; default 'wal'
}
```

## 模型体验

### 已存宿主数据

#### 模型看到的内容

无。该后端不贡献提示词、工具或 schema；它在 `ctx.storage` 后面持久化非会话记录和追加日志，只供宿主侧消费方使用。

#### Token 影响

实时请求 token 为零。

#### KV Cache 影响

无：该后端从不触碰实时请求前缀。

## 已知限制与暂缓事项

- **`DatabaseSync` 是同步的**：每次写入都会在单条语句或追加事务执行期间阻塞事件循环。
- **没有忙等待或重试策略**：另一个连接持有写事务时，该操作会立即被拒绝；调用方通过自己的持久命令逻辑重试 `sequence-conflict` 或 SQLite 锁失败。
- **只打开当前的 `STORAGE_SQLITE_SCHEMA_VERSION`**：其他任何已标记版本都会被拒绝而不是迁移（预发布立场）。
- **`openDatabase` 重复了会话持久化 SQLite 的打开顺序**：提取到共享介质层的工作暂缓至计划的会话后端迁移（见 Agent Note 的复用审计）。
