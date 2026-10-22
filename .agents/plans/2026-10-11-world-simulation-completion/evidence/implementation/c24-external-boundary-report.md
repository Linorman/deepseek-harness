# C24：模拟外部效果边界

18 类禁止载荷（request/plan 两侧的 source、sink、create-resource、sender、URL、network-adapter、email、payment、credential）× company/laboratory × JSON/SQLite × source/plain Node lib，共 144 个真实 Loader case、288 个独立 OS 进程。全部通过；144 次独立 cold 均为 paused、零模型调用。此证据接受 X11 的未安装 source/sink 分支；X13 的 public API/UI 标识尚未完成，继续保持未勾选。

精确命令，cwd 为项目根；runner 保存实际子进程 command/args、stdout/stderr、code、signal、timedOut、backend、scene 与原始 root：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" PYTHONDONTWRITEBYTECODE=1 python3 .local/world-completion/c24-external-boundary/run-matrix.py src
TMPDIR="$PWD/.local/world-completion/tmp" PYTHONDONTWRITEBYTECODE=1 python3 .local/world-completion/c24-external-boundary/run-matrix.py lib
TMPDIR="$PWD/.local/world-completion/tmp" PYTHONDONTWRITEBYTECODE=1 python3 .local/world-completion/c24-external-boundary/verify-matrix.py
```

相关检查的精确命令（均由项目根运行）：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-external-actor.spec.ts packages/simulation/simulation-local/tests/world-external-mediated.spec.ts packages/simulation/simulation-world/tests/external-mediated.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build:lib:host
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsc --noEmit -p .local/world-completion/c24-external-boundary/installed-tsconfig.json
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsx scripts/run-oxlint.ts packages/simulation/simulation-local/src/run.ts examples/simulation-company/tests/world-external-boundary-cases.ts examples/simulation-company/tests/world-external-boundary-model.ts examples/simulation-company/tests/world-external-boundary-scenario.ts examples/simulation-company/tests/world-external-boundary.snapshot.ts
node .local/world-completion/c24-external-boundary/verify-equivalence.mjs
```

source 72 项用时 149.10 秒，lib 72 项用时 43.33 秒。source 原始目录为 `.local/world-completion/c24-external-boundary/src-20261012T141608Z-c06c2888`，lib 为 `.local/world-completion/c24-external-boundary/lib-20261012T141933Z-82c42331`。两个 mode 保存相同的输入 inventory 和物理字节副本，执行前后未变化；digest 为 `e8dec8445a36d7f33237648bbdae0560c4e38a95975e643b7d9fe11f338d30fe`，Native stream 75。范围为选定 runtime package groups、源码、编译 JS、manifest、原 presets、compiler fixture、场景和边界 fixture，非完整动态 import trace。成功和失败的 Native/Team/Channel/Session 原件均保留在项目目录。

[独立原件核验](c24-external-boundary-root-verification.json) 校验 4,948 个文件 hash、288 个真实错误收据及其 Session tool/result、原禁止 stage 载荷、两个精确 submit、相同业务状态、原 stock7/money999、唯一 external identity、未生成代表或新资源、原 initial/final checkpoint 及冷启输出。禁止请求不产生第二业务结果；禁止 plan 的两个错误均不改变原责任，随后模型明确提交合法 failure，独立作为第二正常事项记账。普通 cognition 的 Session、决策/token 等预算计费正常发生，测试没有要求合法模型步骤零记录。

运行中的模型只有原三工具和 scripted cognition，测试 observer 始终调用 waterfall `next()`，不修改 tool 结果或 Native row。禁止请求和 plan 均在实际 Native acceptance 严格解析边界被拒绝；没有网络、邮件、付款或资产铸销 adapter。合法初始资源由可信 bootstrap owner 建立；外部展开仍走原模拟 owner，不授予该 bootstrap 能力。既有正例资源和合同保持证据见 [C17](c17-external-contract-report.md)及 [C23 实际裁决代表](c23-mediated-actor-proof-20261012.md)，独立复核见 [C23 root audit](c23-mediated-actor-root-audit-20261012.json)。未安装 source/sink，因此没有伪称执行 grant、mint/burn 或台账来源/消耗。

原 pilot 8 项失败保留在 `pilot.log`：失败发生在冷启 JSON 省略 undefined 字段与内存结构的比较；修正 owned projection 后 `pilot-second.log` 8 项通过，没有改变业务拒绝条件。完整冻结矩阵以后仅调整 fixture 的注释和换行以满足 lint；其语义比较记录在 `c24-current-fixture-equivalence.json`。

修复 `commitExternalRepresentative()` 在 v3 实际提交时漏记首次联系 wake：其原 requester first-action、director notification、ready/represents/result 同批追加，完整 batch 仍受原 maxBytesPerPlan 约束。v2 没有首次联系 duty 的返回语义不变。相关 3 files/42 owner tests、host lib build、fixture 类型和 lint 通过；精确检查命令和日志在本项目 `.local/world-completion/c24-external-boundary/`。不声称新的 SIGKILL、完整 v1 authoring、SDK/UI 或真实 provider 质量验收。
