# Agent Note: 权威 Simulation 运行状态观察

Status: implemented

[English](2026-10-01-simulation-runtime-status-observations.md) | 中文

## Problem

静态 run 上限与保留历史数量不能解释当前区间用量、预留计费或未释放 writer。为填充目录而打开 run 会取得执行所有权或发起恢复。一个日志失败不能抹去其他授权行的观察，而凭据退役必须丢弃全部持有结果。

## Decision

Simulation Definition 拥有[区间计费](../../../../packages/simulation/simulation/src/budget.ts)与[运行指标](../../../../packages/simulation/simulation/src/metrics.ts)。本地准入与产品观察复用这些函数。token bucket 与总计费通过 BigInt 求和，仅将安全总值转换为数值；不安全的总值拒绝，不进行舍入。unknown 与 reserved attempt 至少保留预留额度或更高的已观察成本，显式追加额度仅用于原区间。

驻留容量在预留准入、projection 验证、population 与公开指标中使用同一个未 release writer 谓词。reserved、active 与 revoked writer 保留计费，但不证明进程物理存活。非 active writer 需要确认，无所有者／不可用的所有权观察不能确认任何保留 writer。待决数量包括 queued／reserved nomination 与 open／submitted decision。待完成外部工作包括没有原生终态结果的通信与任务创建；明确 unknown outcome 仍可单独计数。

[产品目录](../../../../packages/simulation/simulation-product/src/index.ts)通过 `inspect()` 与有限 `runStatuses()` 批次暴露安全指标。验证不同的自有登记身份、部署行数上限与完整请求／结果字节。独立只读 provider IO 通过 all-settled 收集并排空。逐 run 的 provider 或计费失败转为固定安全的不可用摘要，历史缺失仍为缺失。每次 IO 重新鉴权，最终凭据退役拒绝整批结果。不发生 open、restore、推理或恢复动作。

观察结果限制 tick／规则／策略标签，只投影固定 scheduler stop 分类，不包含原始 spec、stall 引用或私有正文。Native 读取明确不掌握行政 driver 与共享模型池事实。行政消费者可从原登记及 live owner 提供这些独立的当前观察；单独的原生历史不能推测它们。新增 DTO 字段仅为旧 peer 保持可选，当前生产方提供观察或明确不可用。缺失字段绝不表示零用量。

## Alternatives considered

**在浏览器派生用量，或向 Product 复制 provider 算法。** 两者均可能偏离准入，尤其在追加额度、取消、unknown 用量或 writer 退役后。

**打开或恢复每个目录 run。** 列表会取得所有权或改变保留的恢复责任。

**一个 provider 失败就拒绝全部行。** 独立的不可访问日志不能隐藏其他授权历史；认证失败仍使整批响应失效。

**并行读取有一项拒绝就立即返回。** 卸载可能在另一项已准入读取仍运行时关闭目录。

## Consequences

用量来自一个原生 revision 与模拟区间的观察；模型池活动是独立的真实时间 owner 观察。观察到超额用量后，已计费 token 可以超过上限，但不能变成舍入值。驻留槽位计数保留的准入容量，而不是活动推理。有限批次保留请求顺序，完整响应超限时拒绝，不返回部分行。

## Verification

真实 JSON 与 SQLite Native 测试将指标与预算准入及 population 对比，writer release 后保留 unknown 成本，包含显式追加额度与 queued decision，验证超出 Number 范围的十进制区间精度，并拒绝不安全的 token 总和。产品测试无接管地观察真实持有历史，隔离私有 provider 失败，对不安全总值返回不可用，拒绝畸形指标与不合法身份／数量／字节请求，并在凭据退役时排空其他已准入读取。既有预算、token 与产品读取回归保留准入及检查行为。传输与 UI 验证由其消费者负责。
