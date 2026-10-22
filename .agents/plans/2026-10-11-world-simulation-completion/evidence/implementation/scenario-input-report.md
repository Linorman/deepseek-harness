# 场景输入层实施证据

日期 2026-10-11（Asia/Tokyo）。源码与测试输入 hash 为 `b9411c0062f7aa6f922ab23957dd9f21ed649ab6a286c7a8a9552490208a8f69`，逐文件 hash 见[manifest](scenario-input-manifest.json)。未提交、推送或刷新 snapshot；只使用项目内临时目录、缓存和构建目录。

本部分完成 S02/S03 的语法与容量合同：显式 JSON/YAML 进入同一 compiler，重复键、tag、directive、merge、anchor/alias、多文档、非法 key/标量和 include 拒绝；原文件/序列化值、深度、节点、引用、集合与完整 resolved 结果都有固定限额。YAML AST 在转换前检查，日期文本保持字符串，时间字段要求字符串。两端诊断 parser 同步可选格式与行列，非法位置拒绝。

真实产品场景从项目内 YAML 文件解析出定义，经 authenticated Host fetch 和原产品命令创建公司/实验室 × JSON/SQLite 的暂停运行，检查同命令精确重试、原身份、导出和 JSON/YAML 往返；source 与 lib 均为零模型调用。纯输入层不拥有持久状态或模型输入，沿用 simulation-scenario 的有理由空 invariant；新增代码不修改 Native stream。

| 验证 | 实际结果 | 日志 |
|---|---|---|
| focused | 198 tests / 4 files passed | [scenario-focused-verified.log](scenario-focused-verified.log) |
| Python | 8 passed | [scenario-python-tests-final.log](scenario-python-tests-final.log) |
| source product | 4 passed / 60 deliberately unselected; company/laboratory × JSON/SQLite | [scenario-product-source.log](scenario-product-source.log) |
| lib product | 4 passed / 60 deliberately unselected; requires latest full build | [scenario-product-lib.log](scenario-product-lib.log) |
| build/types | Host + Client tsc aggregates and bundles + web; 197 client artifacts | [scenario-build-verified.log](scenario-build-verified.log) |
| typed lint | exit 0; no diagnostics | [scenario-lint-complete.log](scenario-lint-complete.log) |
| catalog | regenerated strict diagnostic DTO metadata | [scenario-catalog.log](scenario-catalog.log) |
| pairing | 4 pairs recorded; full gate passed | [scenario-pairing.log](scenario-pairing.log) |
| documentation | 29 passed / 0 failed / 0 skipped | [scenario-doc-sync-final.log](scenario-doc-sync-final.log) |
| whitespace | exit 0 | [scenario-diff-check.log](scenario-diff-check.log) |

准确命令如下，日志重定向位置对应上表：

focused：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-scenario/tests/compiler.spec.ts packages/simulation/simulation-scenario/tests/input.spec.ts packages/simulation/simulation-product/tests/world-schema.spec.ts scripts/client-bundle-purity.spec.ts > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/scenario-focused-verified.log 2>&1
```

Python：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" PYTHONPYCACHEPREFIX="$PWD/.local/world-completion/pycache" PYTHONPATH="$PWD/python/sdk/src" python/sdk/.venv/bin/python -m pytest python/sdk/tests/test_simulation_scenario.py -o cache_dir="$PWD/.local/world-completion/pytest-cache" > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/scenario-python-tests-final.log 2>&1
```

source product：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_SNAPSHOT=replay CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-product.snapshot.ts -t 'safe YAML' --maxWorkers=1 > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/scenario-product-source.log 2>&1
```

lib product：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT=replay CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-product.snapshot.ts -t 'safe YAML' --maxWorkers=1 > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/scenario-product-lib.log 2>&1
```

build/types：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/scenario-build-verified.log 2>&1
```

typed lint：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsx scripts/run-oxlint.ts packages/simulation/simulation-scenario/src/input.ts packages/simulation/simulation-scenario/src/compiler.ts packages/simulation/simulation-scenario/src/types.ts packages/simulation/simulation-scenario/src/index.ts packages/simulation/simulation-scenario/tests/input.spec.ts packages/simulation/simulation-product/src/world-schema.ts packages/simulation/simulation-product/tests/world-schema.spec.ts examples/simulation-company/tests/world-product-scenario.ts examples/simulation-company/tests/world-product.snapshot.ts > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/scenario-lint-complete.log 2>&1
```

catalog：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run gen-cordis-catalog > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/scenario-catalog.log 2>&1
```

pairing：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run verify-translation-pairing --write packages/simulation/simulation-scenario/README.md packages/simulation/simulation-product/README.md docs/subsystems/simulation.md .agents/notes/proposed/feature/2026-10-08-world-director-mvp.md > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/scenario-pairing.log 2>&1
```

documentation：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/scenario-doc-sync-final.log 2>&1
```

whitespace：

```sh
git diff --check > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/scenario-diff-check.log 2>&1
```

首次测试暴露对共享内存对象的过度拒绝，已修正为只拒绝循环并按实际展开序列化计费；初轮 lint/build 的非空断言、行宽、测试 any 与未使用 import 均已修正。初轮 doc-sync 的生成目录过期已按 owner 重新生成。早期失败日志保留在此目录，以 verified/final 文件为最终结果。

支持的定义仍为 `clocky.world/v0`。S01 的完整 v1 定义、U01 的文件/表单 UI 和新领域均未交付；S08 仅有现有语义往返证据，仍不勾选整个扩展要求。没有宣称独立 compiled TS SDK/已安装 Python wheel、本轮 GUI 或真实模型验收通过。B04 的 route/budget 缺口不阻止 keyless C1 开发。

后续沿既有开发计划推进 C1a 的严格 domain/operation/version envelope、typed evidence/read-set 与 schema/implementation 注册；接着 C1b 普通目标自主申请和 C1c handler 分派。P/F/G/O/X 组当前没有完成证据，不提前勾选。所有 112 个原条目保持原有数量和 ID。
