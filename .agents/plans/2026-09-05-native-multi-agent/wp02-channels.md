# WP02：Direct v4 与 durable channel admission

主责：协议程序员。负责 G03/G04。前置：复用已实现 P0 基础并登记 C1；按用户最新优先级立即开发，不等待完整覆盖率放行。下游：WP04/05/08/10/13。必读[共享约定](contracts.md)及[P1 direct/admission 规格](../../notes/proposed/architecture/2026-09-04-native-multi-agent-p1-product-convergence.zh.md)。

## 当前基础与源码

[direct adapter](../../../packages/team/team-channel-direct/src/direct.ts)有 v1/v2/v3，但只接纳一个收件人；产品协议固定两方。[Hub 创建频道](../../../packages/team/team-hub/src/index.ts)直接写 opened/active。[Core](../../../packages/core/team/src/runtime.ts)已有 implementation lease，[local Link](../../../packages/team/team-link-local/src/index.ts)和[WebSocket Link](../../../packages/team/team-link-websocket/src/index.ts)已有 delivery/receipt。

独占 direct adapter 与拟新增的 team-channel-admission Consumer；共享 Core/Hub/Link 变更按 C1 合入。WP03 拥有摘要生成，不在本包增加隐式摘要。

## 拟议约定

Direct v4 的 message 接纳至少两个不同的 active Participants。audience 可以为 null，或不重复、非空、不含 sender 的成员子集；Hub 在 commit 时固定 recipient intents。消息保留 v3 的有序 text/image 和 delivery intent；不得自动回复或自动广播 assistant output。

final 只能出现在 exact two-party product channel，收件人必须是唯一授权 human，delivery 为 turn，禁止 null。child result 由 WP05 的专用 result 语义拥有，不放宽 root final 来迎合 child。

频道创建的一次 WAL batch 写 opened、pending 和 required/optional invitations。每份 invitation 保留 role、visibility、deadline、endpoint expectation、revision/idempotency。ack 通过 activation proof、human proof 或具名 service proof，提交时检查当前成员与精确协议版本。全部 required ack durable 后才 active。

## 实现步骤

1. 增加 v4 正负协议测试和 invitation/ack fold/property 测试，明确允许的 phase transition。
2. 先完成 v4 的纯 validate/fold/deliveryPlan/projectView；在 existing adapter lease 上运行，不改旧版本含义。
3. 增加 durable invitation/ack 记录与 schema，严格校验旧格式；新 admission Consumer 只重投尚未确认邀请。
4. 接通 local、WebSocket、human 和 service ack。接收者必须确认自己支持精确 manifest/version；注册表中存在插件不能代替 endpoint ack。
5. 实现 required 超时 expired/failed，optional 超时的 adapter-authorized removal；取消时先结束 invitation，再释放 implementation。
6. 所有内部结构频道走同一 durable admission 语义：scheduler wake、review consult、workflow、TeamRun user channel。内部 service 可立即提交有证据的 ack，但不能存在直接 active 的隐藏分支。
7. 修改 TeamRun 模板与 Host/SDK channel operations；和 WP04 协调“只有 active wake channel 才能 dispatch”，和 WP08 协调 human ack。
8. 更新默认组合和 keyless 快照；旧 v1–v3 可按 WP12 的显式兼容规则保留，不能静默升级旧 WAL。

## 竞态与限制

开启频道时先 acquire 精确实现租约；WAL 或 Team attachment 失败释放未发布句柄。已发布频道退休后继续使用原对象；重启缺精确版本时失败。pending channel 禁止普通 send，但允许其受限 ack/expiry/close。

close 与 ack 同时到达时，以锁内 cursor 决定结果；终态不能被迟到 ack 复活。广播成员集合在 commit 固定，之后新增成员不获得旧 Envelope 的默认 receipt。一个慢 recipient 只占自己的 pending slot。

## 验收矩阵

| 场景 | 必需断言 |
|---|---|
| subset、null broadcast、text/image | recipient intents 正确且不可变，所有接收者独立 ack |
| self/重复/空/非成员 audience | 在 durable Envelope 前拒绝 |
| 广播 final 或多人 final | 拒绝；两方 final 仍可通过原 completion policy |
| pending send | 拒绝，不偷跑模型 |
| startup 重投 invitation | 已 ack 不重投，未 ack 可重复且无重复 phase |
| required/optional deadline | 配置时钟驱动，结果 durable，重启等价 |
| ack 与 remove/close/revoke | 不复活关闭频道，不借旧身份确认 |
| retire/HMR/receipt drain | active/terminal pending 保留租约，完成后释放 |
| scheduler/review/workflow | 等待 admission 后才开始，失败有明确 task/channel 处置 |

## 检查与交接

```sh
pnpm exec vitest run packages/team/team-channel-direct/tests packages/team/team-hub/tests packages/team/team-link-local/tests packages/team/team-link-websocket/tests
pnpm exec vitest run --config vitest.snapshot.config.ts examples/headless-agent/tests/headless-team-run.snapshot.ts
```

开发时按场景进一步选窄测试；本包最终验证包含新增 admission 包、Link Hub、Host 和两 SDK 对应场景，不能只跑 adapter。将 v4 wire/manifest、ack 请求、超时错误、默认组合切换和 snapshot 交给下游。

建议切片为 direct v4、admission 端到端、本地模板及远程消费者切换；每片保持一条可运行路径。
