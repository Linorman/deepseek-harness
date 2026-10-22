# 求值 append 前：原计划的明确完成

该补证只覆盖 `evaluation-append-before` 的公司／实验室 × JSON／SQLite × source／plain Node lib，共 8 case、8 次真实 SIGKILL、16 个独立冷恢复、56 个新 JSON 原件。source 4/4、lib 4/4，scoped TypeScript／lint exit 0。原完整 96-case 矩阵与原四文件输入保持不变，另存 `previous-fixture` 精确源字节；没有重跑其它 88 个窗口，也没有修改生产代码或 checklist。

第一 cold 保持原 accepted plan，actual evaluation／mutation／result 为零；未 append 的热进程候选不是实际保存结果。第二 cold 在 paused 中，由原 owner 调用公共 `run.commitWorldMutation`，使用原 planId 和严格 `evaluate-rule` payload，保持 identity、原 input／policy、原计划与资源，首次原子保存一份实际 deterministic evaluation、mutation、result 和安全 wake。`recordedAt`、sequence 来自这个实际 cold2 append，不把先前临时候选元数据冒充已保存原件。

随后同一进程精确重试原请求，返回完整原 result。通过测试期内调用原领域 `reduceMutation` 的计数器验证，第一次 commit 确实执行原逻辑，重试没有增加计数；同时完整 snapshot、Native revision、stream tail 和实际 evaluation 原件完全不变。全部 cold 模型计数为零，没有启动人物、生产性 driver advance、时钟移动或资源变更。

准确命令／当前四文件 hash 见 [command manifest](c21-evaluation-before-command-manifest.json)，56 份原件逐项检查见 [artifact verification](c21-evaluation-before-artifact-verification.json)。新独立 nonce 为 `validation-20261012T104702Z-a5a0fbc2`。运行前后 [source／JS inventory](c21-evaluation-before-input-manifest.json) 与 [end inventory](c21-evaluation-before-end-input-manifest.json) 完全相同：653 源文件 hash `abcf6065f1a8fb8471d6e3665b5ddd9d338abb38d28eba32150e4a7aed125f8b`；821 JS hash `503691929390b28686c991b564d461a1c6e29e42ee40e6ecd5bbd2827fcf00f5`。这些是保守 runtime inventory，不能称全部实际 import 追踪。

首次 lint 的项目内 TMPDIR 太长，触发 macOS Unix socket `EINVAL`，日志保留；使用项目内短 tmp 后最终通过。完整 X12 的最终 audit 仍由主代理负责，该补证不把尚未 accepted 的 before-request 情况描述为已经完成请求。
