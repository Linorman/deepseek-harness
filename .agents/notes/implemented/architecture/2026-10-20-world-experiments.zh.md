# Agent Note：隔离的世界实验

Status: implemented

[English](2026-10-20-world-experiments.md) | 中文

## Problem

直接修改历史证明中的 ID 会在实验之间转移权限。便携 cut 需要新的执行身份，并明确记录继承的事实和模型输入。

## Decision

[分支初始化](../../../../packages/simulation/simulation-team/src/experiments.ts)创建新的可写 owner，不修改历史证据中的标识符。Native `run/branch-init` 在普通实体、Team、Participant 和 Channel 创建前保存准确来源 cut、原命令命名空间、记忆策略和预算。支持初始世界和已结清世界两种 seed 格式。已结清 cut 保留当前实体、关系、余额和模拟时间；新的文本事实引用 branch-init 事件，继承的私密陈述成为明确的新 belief。未完成义务、事件和未知效果会拒绝，而不会丢失原 owner。已安装 Native provider 对不可变前缀执行纯内存重放并检查与普通 inspection 相同的投影不变量，无需访问原运行存储；归档闭包 hash 本身不能验证 snapshot 投影。原父归档在独立 storage owner 中持久保存，分支导出递归携带只读 provenance；整包字节、全链记录总量和最多八层父链限制完整闭包。

两种记忆策略都保留作者定义的 profile 和场景事实。public-facts 排除初始私密知识和 Session 历史；authorized-memory 通过仅 detached 的 `Session.create(...).deriveMessages()` 取得每个 actor 原 Session 的实际模型历史，将其文本化记录到新 Session；原 raw events 的内部 proof、计费和非 surface 元数据仅保留在 provenance 审计，附来源 hash 和策略。继承 Session 先作为 detached 对象持久化；seed actor 首次激活通过 resume 读取原日志，之后新生成的 actor 仍走 fresh 路径。两者都不转移签名、receipt 或原执行权限。真实 effects 保持禁用。原命令重试重开原命名空间，对账原身份预留和已持久化继承输入；来源或 payload 改变则拒绝。

[因果查询](../../../../packages/simulation/simulation-team/src/experiment-query.ts)直接从 Native 记录中的明确引用构建边，不使用 snapshot 关系。manifest 使用 B1 完整前缀 hash 约定。每次读取应用当前来源权限；被拒绝节点不贡献边或存在性计数。元数据包裹后再执行完整结果边界。比较要求相同父 cut，仅规范化明确的 lineage 身份字段，保留普通文本，并分别说明质量/成本证据缺失、非确定性与已记录事实差异。

## Alternatives considered

改写父日志会使证据失效。直接复制当前 snapshot 会保留旧可执行身份和批准。新的 owner 命令建立每条受支持的新事实，原历史单独作为 provenance 保存。


## Consequences

[owner 测试](../../../../packages/simulation/simulation-team/tests/experiments.spec.ts)覆盖 JSON 和 SQLite Loader 组合、部分初始化重试、动态 cut 时间、新 canonical 身份、公私记忆隔离、实际继承 Session 输入、分支事实可写和原运行保持、准确 Native 重开、权限 fence、极小字节边界和不受 snapshot 伪造影响的因果索引。[双进程快照](../../../../examples/simulation-company/tests/world-experiments.snapshot.ts)在持久化部分分配后退出，并在另一个进程恢复原命名空间。

联邦来源/provenance、制度/委员会、外部身份、环境/演化状态、未完成义务和未来事件的 seed owner 仍不支持；其他干预变量、全生命周期 token 预算、模型 judge 质量集成和自动历史合并也不支持。声明的 token 预算为 Native 周期预算。受支持动态 seed 格式拒绝无法表达的责任；Product 的独立分支命令日志持久保存原接受和完成记录，先纯预检，再生成新的 `world/1` checkpoint、WorldOwner 和 paused 目录；冷恢复后可显式 start/pause。V0 来源要求当前 Host 目录经纯编译精确重建原解析语义；完整匹配目录在接受时一并保留，所有重试使用冻结原件。V1 保留自包含编译输入。Host、Client 和两 SDK 的 branch/read/compare/causal 家族使用同一 owner，私密完整归档权限独立检查。分支备份携带 readonly 父 provenance；验证见 [Product 实验测试](../../../../packages/simulation/simulation-product/tests/experiments.spec.ts) 和 [README](../../../../packages/simulation/simulation-product/README.zh.md)。authorized-memory 目前只支持文本 Session，媒体和非文本内容在纯预检拒绝；public-facts 可以省略这些私密媒体。

初始化和继承输入使用版本 2；Native 重放拒绝版本 1 原始事件记忆格式，不转换或改写原件。无分支初始化的普通 journal-101 运行仍可读取。仅按已声明 schema 重映射 Entity 引用，资源/事实/知识/关系/模板保留各自运行域 ID；正文和 Persona 名称原样保留。缺少 owner 的已声明 Entity 引用在纯预检拒绝。

分支预检要求 Entity 映射为一对一：当长源 ID 与等于其截短摘要的短 ID 冲突时，在分配目标前拒绝。已接受命令的既有映射保持稳定。继承 Session 的恢复通过持久化清单区分进程内惰性预留与已落盘头部。首次追加失败后可以继续原预留；追加已提交但回执丢失时，验证原输入而不重复追加。在创建惰性头部之后、追加继承输入之前再次检查当前授权。JSON 和 SQLite 测试覆盖这两个故障边界，并验证冲突身份在创建目标前被拒绝。
