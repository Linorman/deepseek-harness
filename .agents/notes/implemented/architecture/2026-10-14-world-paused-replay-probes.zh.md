# Agent Note：暂停世界回放与显式生产

Status: implemented

[English](2026-10-14-world-paused-replay-probes.md) | 中文

## 问题

若计数器修改的是 Agent 子 Context 不调用的绑定服务，零值没有证明力。冷回放还必须保留已接受 Persona 与外部结果，不能仅避免模型请求。已认证的新 start 必须正向证明同一观察器能够看到生产调用。

## 决策

[进程内回放探针](../../../../examples/simulation-company/tests/world-replay-probe.ts)观察实际 `llm/stream` waterfall 和已安装领域执行方法。新显式 start 前，探针拒绝这些调用及环境随机采样。脚本场景同时拒绝全局 fetch 与 socket 连接尝试。这些拦截仅用于测试；UUID 分配和文件系统访问保持正常实现。

完整世界冷进程恢复真实原 Native/Team/Session 状态，尝试一次暂停 driver batch，再比较完整状态、Session 事件与 journal。公司生成新人和外部代表保留已接受 profile；协会保留原外部裁决。已有真实 seed 可提供两轮新冷进程，无须重跑已接受流程。

产品模型池场景通过已认证 API 恢复，读取 control/inspection/export 不改变 revision、不调用模型，随后提交新的 management ID。只有这个显式 start 开放探针的生产区间。实际 waterfall 次数必须等于脚本 provider 的正调用数。同一 start 重试保持 revision 与调用数。证据模式保留两个进程、已接受输入、原 World 与继续运行证明。

## 考虑过的替代方案

**只修改 `ctx.llm.stream`。** Cordis 服务绑定可绕过该对象；正向继续测试暴露了观察缺失。

**从 paused 标志推断安全回放。** 状态本身不能证明没有模型、执行或网络效果，也不能证明已接受来源保持不变。

## 后果

显式启用的探针经过真实 Loader、driver 与产品路径，不修改生产语义或上限。所有进程内方法和事件监听器在拆除时恢复；拆除不会从已 dispose 的 Context 解析服务。完整 snapshot 保留全部已接受内容；不会给确定性 simulated-rule 实现增添采样子系统。真实 provider 质量、更广故障矩阵与已安装 SDK 分发仍属独立验收。
