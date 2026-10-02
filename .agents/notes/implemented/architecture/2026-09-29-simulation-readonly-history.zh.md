# Agent Note：Simulation 只读历史

状态：已实施

[English](2026-09-29-simulation-readonly-history.md) | 中文

## 问题

Simulation provider open 会取得 coordinator 锁并创建 backend 资源。产品浏览不能复用它，否则会成为另一个执行 owner，或改变缺失运行的行为。Backend log open 也持有自己的 writer 生命周期，同样不适合。

## 决策

Storage 负责明确的行数、编码／完整返回字节额度，以及分离的 sequence 元数据。JSON 用有界只读文件描述符读取现有原子文档；SQLite 在读取事务中检查现有 schema／stream，不初始化或迁移 backend。两者保留 version、连续性和 checkpoint 检查，区分缺失历史，超额会拒绝。不取得 backend writer handle。

SQLite 只读连接可能创建或复用 WAL／SHM 辅助文件，应用 row、数据库 format 和 coordinator owner 文件保持不变。[SQLite WAL 格式](https://www.sqlite.org/walformat.html)定义此行为；immutable mode 不适合仍在变化的 live database。错误 medium 或 reader 失败保持为错误，不回退到 writer open。

Simulation registry 将检查解析与执行 open 分开。Provider 不支持检查时在 IO 前失败。本地检查要求部署选定的 provider 与不可变 spec，通过既有 fold 和投影检查重放完整保留历史，返回可信原生 snapshot 与所有权观察。原生读取方负责鉴权和公开删节；这不是 Web DTO。

`inspectionMaxEntries` 与 `inspectionMaxBytes` 配置观察额度。通过只读方式探测现有 kernel owner，不取得、替换或删除其数据库。观察区分本 provider、另一 coordinator、未持有或不可确认；均不能授权接管。已持有 run 按不可变 run ID 建立索引，成功排空后先移除索引再释放 owner。Provider 卸载关闭检查准入，等待已接纳观察后才释放已有 run。

## 考虑过的替代方案

**把历史打开成另一个 run。** 它会与 coordinator ownership 冲突，还可能创建存储。

**对 live run 使用 immutable SQLite mode。** 可变 WAL 状态需要普通的一致性读取和锁机制。

**只读未经验证的缓存摘要。** 它无法验证历史，也不能重建实体／决策详情。

## 后果

完整历史重放和复制有额度限制，但可能昂贵；此项不声称性能提升或无界规模支持。超额或不完整历史会拒绝，不截断世界 snapshot。产品登记及已认证元数据投影属于[产品目录](2026-09-29-simulation-product-directory.zh.md)；可变 ACL、owner 合并、行政恢复、driver 与 Web／SDK 接入仍是独立工作。读到持久 running phase 不会继续执行，也不代表已有 live 产品 owner。

## 验证

Storage 测试覆盖缺失 medium 不创建、live writer 旁读取、分离值、physical／stream version、损坏 JSON、连续性、UTF-8 额度、checkpoint、compaction 和 medium 大小变化。Simulation 测试在本地／外部 owner 持有及释放后保持 phase／revision，拒绝错误 spec／medium，并保持缺失目录不创建。Keyless runnable-example snapshot 对 JSON／SQLite 启动真实 Loader 进程：一个持有 coordinator，另一个检查相同 running 历史，再在释放后重新读取，均不打开执行 ownership。
