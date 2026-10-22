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

人员义务盘点使用独立的只读 provider 方法和原先安装的 Native 领域清单。它将有界报告与重放得到的 snapshot 配对，不打开或恢复 run。Team 服务将该盘点与实际 task、attempt、activation、workspace 和 Channel delivery 记录组合，再复验 Native 与 canonical 来源前缀。来源移动、缺少 canonical 覆盖和超额均保持不完整；服务卸载和取消会阻止迟到结果发布。产品义务分页除绑定 Native revision 及已认证 reader／disclosure 生命周期外，还绑定完整报告指纹。各行保留精确的 typed owner 引用、原状态和不确定性；只有实际可导航目标才提供链接。元数据和完整盘点都不授予取消、调岗或离职权限。在显式读取完整盘点之前，人员列表的义务数量仍为未知。

## 考虑过的替代方案

**把历史打开成另一个 run。** 它会与 coordinator ownership 冲突，还可能创建存储。

**对 live run 使用 immutable SQLite mode。** 可变 WAL 状态需要普通的一致性读取和锁机制。

**只读未经验证的缓存摘要。** 它无法验证历史，也不能重建实体／决策详情。

## 后果

完整历史重放和复制有额度限制，但可能昂贵；此项不声称性能提升或无界规模支持。超额或不完整历史会拒绝，不截断世界 snapshot。产品登记及已认证元数据投影属于[产品目录](2026-09-29-simulation-product-directory.zh.md)；可变 ACL、owner 合并、行政恢复、driver 与 Web／SDK 接入仍是独立工作。读到持久 running phase 不会继续执行，也不代表已有 live 产品 owner。

## 验证

Storage 测试覆盖缺失 medium 不创建、live writer 旁读取、分离值、physical／stream version、损坏 JSON、连续性、UTF-8 额度、checkpoint、compaction 和 medium 大小变化。Simulation 测试在本地／外部 owner 持有及释放后保持 phase／revision，拒绝错误 spec／medium，并保持缺失目录不创建。Keyless runnable-example snapshot 对 JSON／SQLite 启动真实 Loader 进程：一个持有 coordinator，另一个检查相同 running 历史，再在释放后重新读取，均不打开执行 ownership。

[Provider 盘点测试](../../../../packages/simulation/simulation-local/tests/personnel-inspection.spec.ts) 在不执行 open 的情况下保留实际已持有和 cold JSON／SQLite 义务。[Team 盘点测试](../../../../packages/simulation/simulation-team/tests/personnel-readonly.spec.ts) 读取真实 canonical task 责任，拒绝取消后的迟到结果，并将 Native 移动标为 partial。[产品盘点测试](../../../../packages/simulation/simulation-product/tests/world-personnel-inventory.spec.ts) 保留必填可空引用，并在暂缓 Native 确认期间真实提交 Channel acknowledgement 后拒绝旧 cursor。Python 测试覆盖每种引用、缺失必填字段、未知字段及必填 null 序列化。这些 owner 测试不能证明完整浏览器或真实模型验收矩阵。

<a id="derived-inspection-index"></a>

## 派生检查索引

显式维护在严格 schema 校验和文件同步后，使用同目录私有暂存文件与原子重命名发布 `inspection-index.json`。版本化 manifest 保留连续序列、kind、hash 引用及精确源前缀 hash。发布前失败保留旧文件；中断的暂存文件永不被选中。重命名后目录同步失败时必须重新读取已发布 manifest。业务记录不被删除或重写。

检查始终在现有条数/字节限额内验证原始完整前缀。源 hash 相符时可复用引用元数据，每次观察仍使用精确安装的原领域实现执行原 reducer 和最终不变量。持久索引缺失、格式错误或过期时回退此有界路径。持久引用不提供业务值、权限或计数。provider 不保留第二份完整业务投影：JSON 文档本就需要源解码，额外的 detached snapshot 缓存增加内存，却不消除扫描。SQLite 详情回放使用一致的有界分页；JSON 仍明确采用有界完整文档。完整快照字节核算逐条累加准确的记录编码和包装，不再构造第二份全日志 JSON 字符串。这些路径均不宣称历史读取为常数时间。

认证 Product、Host fetch、Client runtime 及两套 SDK 暴露精确 revision 的索引重建。源 IO 后及发布准入前重新检查传输身份、运行所有权和策略代次。集合游标包含策略代次，其替换后丢弃迟到结果。重复重建请求不产生业务效果或模型调用。
