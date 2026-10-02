# Agent Note: 原始有界 Simulation outbox 重试权限

Status: implemented

[English](2026-10-01-simulation-original-outbox-retry.md) | 中文

## Problem

unknown 外部结果可能已在目标提交。响应丢失后，重复基于 revision 的重试请求可能再次追加额度；冷产品重放也缺少当前认证的 run 修改权限。静态 attempt 上限不能证明精确当前 operation 可重试。

## Decision

[原生约束](../../../../packages/simulation/simulation/src/outbox-retry.ts)验证不可变 command id、原 operation、正数 attempt-count fence、规范化 reason 与原受理现实时间。原 grant 在 operation 的 outbox 下保留请求、原生 sequence／time、budget start 及不变的 `outboxMaxAttempts` 上限。运行内同一身份不能选择其他载荷或 operation。相同重试在后续 attempt、结果、phase 或冷重放后返回历史 grant，不再追加记录。

新 grant 要求准确的当前 unknown、已到期外部意图及最新记录的 attempt，依赖必须已应用，且不能处于原生维护中。修改 fold 与读取投影共用 eligibility 函数。grant 不改变 operation action／fingerprint，不发布、推理或恢复调度。Native journal format 45 拒绝旧结构，原四参数 CAS API 已移除。

[行政所有者](../../../../packages/simulation/simulation-product/src/administration.ts)在排队的原生 IO 前持久保留规范化原产品请求。Native 身份派生自原产品 command，`authorizedAt` 使用原 `acceptedAt`，不依赖后来调用方的时钟。[公司所有者](../../../../packages/simulation/simulation-product/src/company-owner.ts)将 retry 与 management／maintenance 串行化，排空活动场景工作，并在所有等待前后及原生队列内重验当前 lease。已证明的准入前拒绝可结束为 failed；未知原生或终态响应丢失使原请求保持 accepted。查询暴露精确原输入，不重试它。

冷 accepted retry command 不自动 launch，也不阻止显式恢复 owner。随后只有当前认证对同一 command 的重试才会对账。grant 清除 owner 缓存的 unknown stop，但保留原生 stalled／paused phase；显式 start 继续同一原意图与目标幂等 key。

产品 operation 详情暴露准确 count／bound 与只读 reason。仅 Native 历史不能声明产品所有权。可释放的 process-local 行政元数据 reader 补充当前 owner、pending request 与容量准入。登记身份使用 entry 对象，因为 contextual Cordis proxy 会包装 callable service 字段。移除登记会使读取观察失效并阻止迟到的准入提示；任何读取提示都不提供修改权限。

## Alternatives considered

**针对当前 revision 重复 CAS。** 响应丢失及后续世界推进可能产生第二份额度，却没有保留原权限。

**仅信任产品请求日志。** 原生目标受理可以在响应丢失后保留，修改所有者必须保存原 grant 以供对账。

**冷加载时自动重试 accepted command。** 持久意图不能证明当前凭据仍允许修改。

**grant 后立即发布。** 重试权限与显式调度意图相互独立；unknown 结果绝不证明目标未提交。

## Consequences

新 grant 仍受既有 outbox policy 限制。相同重试不能退还 attempt 或改变载荷。dispatch 期间仍检查目标权限及原子去重，包括只允许对账时。原请求查询区分未知 accepted 结果与持久 failure，允许客户端在响应丢失后复用同一身份。

## Verification

Native JSON／SQLite 测试耗尽真实存储支持的发布，在重复请求、后来终态与冷 reopen 中保留一份原额度，拒绝过期 count 与变更载荷，并在队列位置及已提交 IO 后重验调用方退役。产品 JSON／SQLite 测试丢失真实 Hub 发布响应，进入 unknown operation，丢失已提交 Native grant 响应，无发布／推理地查询，惰性冷读，显式恢复并对账同一 command，再显式 start 恢复原目标 receipt。首个过期请求与已退役凭据不保留新 grant。administration／review remount 回归验证 reader 释放，并保留其他原请求类型。传输与浏览器验证由其消费者负责。
