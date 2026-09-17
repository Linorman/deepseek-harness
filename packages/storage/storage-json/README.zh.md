# @clocky/clocky-storage-json

[English](README.md) | 中文

[存储中心](../storage/README.zh.md)的 JSON 后端：配置根目录下保存人类可读的 KV 单元和追加日志文件，注册为后端 `json`。设计见[领域 KV 存储 Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md)。

Log facet 每次 yield 扫描一个目录条目，解码规范 stream name，不读取 journal body。请求 prefix 之外的条目也计入扫描工作量。打开 stream 仍执行完整格式验证；discovery 不证明 body 完整性，也不承诺稳定的目录快照。

Log 摘要位于同一份原子替换 journal 文档的 UTF-8 首行。有界摘要读取至多消耗请求的字节预算，关闭文件句柄并验证 header 身份和版本，不解析 entry 或 checkpoint。完整 stream 打开还会验证 header tail 与 entry 一致。

## 模型

- 内存中的单元状态具有最终决定权；每个写入原语都会通过临时文件写入 + fsync + 原子 `rename()` 替换重新发布整个文件。单元文件始终是完整的当前状态：可读性是该后端存在的理由，规模问题则属于 SQLite 后端。
- 缺失文件会作为空单元打开，并在第一次写入时物化。外来或无法解析的文件以 `malformed-medium` 拒绝；已存版本与描述符不同时以 `version-mismatch` 拒绝（预发布立场，不迁移）。
- 跨调用的写入顺序属于调用方（领域层的写入链）；每次调用都具备原子性，并在完成时已达到持久状态。
- 日志流位于 `logs/<base64url-name>.json`。带预期尾序列的追加会原子地重写完整流文档，因此被接受的批次会一同可见；检查点不能倒退或超过尾序列。
- 日志分面会在任何日志操作前取得一个根目录范围的所有者记录。第二个本地 Hub 以 `writer-locked` 失败；同主机的死亡所有者会先被隔离再恢复，而不同主机的所有者会快速失败。

## 配置

| Key | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `root` | string | 必填，无默认值（cwd 回退会让文件散落各处） | 保存单元文件的目录；按需以 `0o700` 创建 |

## 模型体验

### 已存宿主数据

#### 模型看到的内容

无。该后端不贡献提示词、工具或 schema；它在 `ctx.storage` 后面持久化非会话记录和追加日志，只供宿主侧消费方使用。

#### Token 影响

实时请求 token 为零。

#### KV Cache 影响

无：该后端从不触碰实时请求前缀。

## 已知限制与暂缓事项

- Windows 持久性依赖 libuv 的 `rename()`（调用 `MoveFileExW` 并启用替换），没有显式 write-through 标志。
- JSON 日志分面刻意只支持单一 Hub。它拒绝存活的异主机或同主机所有者，而不协调分布式写入者；需要并发写入时使用 SQLite 日志后端。
