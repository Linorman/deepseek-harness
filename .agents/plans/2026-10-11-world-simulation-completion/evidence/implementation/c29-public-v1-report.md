# C29–C30 完整 v1 定义与公开预检

日期：2026-10-13（Asia/Tokyo）。Native76、v1 compiler2。完成 S01/S04/S05 的范围；不声称完整 MVP、作者 UI、完整准备故障矩阵或 SDK 分发流程通过。

显式 `clocky.world/v1` 严格覆盖 metadata、runtimeProfiles、domains、entities、organization、governance、facts、knowledge、resources、communication、externalWorld、behavior、limits。Native 准备与公开 preflight/create/export 使用同一个完整编译结果；没有将新域静默丢入招聘版 v0。严格持久 parser 从原允许 runtime/model/template 元数据重建全部 Native/Team/bootstrap 投影，核对完整字段；创建 owner 另核对原定义与 preview hash。原 v0 输入保持显式版本边界，Native 不兼容旧 stream。

语义字段诊断覆盖重复实体/关系/外部 key、跨域引用、组织环与受管 scope、任职/成员重叠与岗位容量、委员会峰值门槛、资源数量/单位类型/控制者、日期/horizon/observed-available、安装策略参数、真实初始化最低容量、完整 bootstrap UTF-8 字节下界与显式额度上限。未知字段/代码/策略先拒绝。当前没有执行 owner 的 director 事件、未来权限安装返回 `unsupported-feature`，不成功编译 noop。目录重复 profile/template/operation 版本及不可供真实 Participant 使用的空白 preset/capability 属于 catalog 诊断。

公开预检仅查询实际部署元数据；按 provider 的严格 selector 读取实际完整 domain pin，在模型元数据 IO 后重验。创建在分配运行身份前再核对原 pin 与 preview/generation，并先保存完整原 command。四格真实 Loader 中坏 model/domain、改私有事实但带旧 preview 均无 Native/Team/command/Session 新分配；same command 改私有 belief 返回原 payload 冲突。v1 preview 只含实际模型、pins、时态权限、委员会规则、制度 enforcement 元数据与来源数量，不含私有 fact/belief/Norm 正文。

TS protocol/client/server 和 Python parser/client 接受完整 v1 定义与 ready DTO；未知必需变体拒绝。Python 保留必需的 null 区间终点，即使使用 `model_dump(exclude_none=True)`；缺省可选字段仍省略。共享跨语言 fixtures 来自真实 C30 原 command/preview，原件出处保存在 `.local/world-completion/c29-public-v1/world-v1-fixture-source.json`。这不是已安装 wheel 的真实 RPC 创建/恢复验证，也不代替 U12/U13。

## 固定输入与真实组合

Root scoped inputs/wheel SHA-256 `28f7178742ffc48549154b8f3fb5f51ec554dc3b04ef09187521a32c4ef91b15`：[19份输入 hash](c29-public-v1-inputs.json)；完整副本位于 `.local/world-completion/c29-public-v1/frozen-evidence-inputs/`。

C30 执行输入 SHA-256 `6e3a7af379ae404b1cc2dd12d5f6b8131be85f7fc97360b97bb789ed88576f03`：5,317份 source/lib/config、59,173,164字节完整 runtime 副本。JSON/SQLite × source/plainNode lib 四格共16不同 PID，8个只读 cold 与4个显式 public writable restore 全部 paused、0模型。精确 create retry 不增加原 command/identity/Native revision；restore 单独产生真实管理 accepted/completed，恢复原 checkpoint，不能将其当零 append create。初始所有数据、R30/S31 原件来源、canonical Team/Participant/Session/Channel、制度与资源保持。

[最终 source/lib 命令、106原件与所有历史失败](c30-v1-product-proof-20261013.md)；root 独立 `python3 .local/world-completion/c29-public-v1/root-c30-audit.py` 重查全部当前/副本 hash、16PID、原 command、实际零分配证据和恢复原件：[审计](c30-v1-product-root-audit.json)。

## Root 精确验证

以下 cwd 均为 `/Volumes/projects-mac/deepseek-harness`；日志与失败过程均保留于 `.local/world-completion/c29-public-v1/`。

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-product/tests/world-schema.spec.ts packages/simulation/simulation-product/tests/world-preflight.spec.ts packages/simulation/simulation-product/tests/world-administration.spec.ts packages/simulation/simulation-product/tests/world-preparation-v1.spec.ts packages/simulation/simulation-product/tests/world-v1-schema.spec.ts packages/simulation/simulation-product/tests/world-v1-preflight.spec.ts packages/simulation/simulation-scenario/tests/v1-validation.spec.ts packages/simulation/simulation-scenario/tests/v1-compiler.spec.ts packages/sdk/client/tests/simulation-world.spec.ts packages/sdk/server/tests/simulation-world.spec.ts packages/sdk/protocol/tests/simulation-world-results.spec.ts > .local/world-completion/c29-public-v1/unit-complete.log 2>&1
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build > .local/world-completion/c29-public-v1/build-verified.log 2>&1
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync > .local/world-completion/c29-public-v1/doc-sync-verified.log 2>&1
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsc -p tsconfig.host.json --noEmit > .local/world-completion/c29-public-v1/host-tests-final.log 2>&1
```

11 files/238 tests pass；完整 host/client tsc 与 build pass，197 client artifacts；scoped lint `lint-third.log` exit0/无诊断；doc-sync29/29。C29 subagent 原53新/15旧 tests 的输入与失败日志位于 `.local/world-completion/c29-v1-validation/`，其 standalone tsc vendor-boundary failure 保留，root package reference/aggregate 验证已通过，没有把局部失败当类型检查成功。

Python 原源码与安装后的当前 wheel 均153 tests通过；确认 `clocky.__file__` 指向 `.local/world-completion/c29-public-v1/wheel-installed/`，没有回用源码。构建安装记录在 `python-wheel-build.log` / `python-wheel-install.log`，tests在 `python-complete.log` / `python-wheel-tests.log` / `python-wheel-origin.json`。测试命令为：

```sh
PYTHONPATH="$PWD/.local/world-completion/c29-public-v1/wheel-installed" PYTHONPYCACHEPREFIX="$PWD/.local/world-completion/c29-public-v1/pycache-wheel" TMPDIR="$PWD/.local/world-completion/c29-public-v1/tmp" .local/world-completion/c29-public-v1/python-env/bin/python -m pytest python/sdk/tests/test_simulation_scenario_v1.py python/sdk/tests/test_simulation_scenario.py python/sdk/tests/test_simulation.py python/sdk/tests/test_simulation_world_cases.py python/sdk/tests/test_simulation_people.py --basetemp="$PWD/.local/world-completion/c29-public-v1/pytest-tmp-wheel" > .local/world-completion/c29-public-v1/python-wheel-tests.log 2>&1
```

## 未验收范围

完整 Native 初始化最终字节核验包含原 canonical identities/序号与实际投影，compiler 仅可证明完整 book 的已知下界；未提高任何额度。S06/S07/S08 的完整范围、S10/S11、作者表单、三个产品场景、SDK 真正分发/RPC 流程、完整剧本/故障矩阵及真实 provider 试验继续未勾。UI 本轮只同步诊断类型，未声称表单已接 v1，也未将旧 UI 静态审计问题隐藏。所有中间文件、缓存、wheel、编译产物和原件均在项目内；未发布、push 或新增 checklist items。
