# C16 共享外部代表

Native stream 72 安装持久 caller contact、原 generation 复用和 typed external-representation 读项。竞争 create 计划在另一请求先预留后变为 stale，必须通过明确 supersedes reuse 计划引用原 generation。准备未完成时不分配新 Person／Channel；ready 后同 caller 复用原 Channel，不同 caller 获得独立私有 Channel，仍使用原 Person／Session。每个 case 的安全结果及联系 wake 原子提交，精确 reserve／commit 重试零 append。

实际 company／laboratory × JSON／SQLite 在 source 和 plain Node lib 各 4 组通过；24 独立进程、16 cold 零模型调用。两个真实 Agent goal 在同一 Native window 并发受理；held reserved／typed stale／原 supersedes reuse／canonical Session 收发及隐私 canary 均保留原件。每组最终只有一个身份、一个代表 generation、三个联系和两个买方私有 Channel，九个 canonical 收发核对完整 source/body。详见 [fixture 报告](../../../../../.local/world-completion/c16-external-shared/fixture-report.md)、[source](c16-external-shared-source.log)、[lib](c16-external-shared-lib.log)、[73 原件核验](c16-external-shared-fixture-verification.json)。

X05 完整覆盖。X06 的原合同表为空，尚无非空供应商合同保持证据；X10 超限、X12 取消清理／未知 IO／SIGKILL 及 v1 作者／SDK／UI 完整验收继续待办。取消联系只保留 cancel-requested 与原责任，不宣称已清理。原失败日志保留；不放宽额度、不新增 checklist items。

本部分最终验证：owner／相邻领域 8 文件 115 项通过，原 availability／actor／preparing／driver 的 compiled regression 4 文件 20 项通过；完整 build、Host TypeScript、当前生产与 fixture 文件 lint、双语配对及 doc-sync 29 门禁通过。日志：[focused](c16-focused.log)、[lib regression](c16-lib-regression.log)、[build](c16-build.log)、[types](c16-types.log)、[lint](c16-lint.log)、[doc29](c16-doc-sync.log)。准确 fixture 命令保留在原 fixture 报告；其它最终命令如下。

```sh
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external.snapshot.ts examples/simulation-company/tests/world-external-actor.snapshot.ts examples/simulation-company/tests/world-preparing.snapshot.ts examples/simulation-company/tests/world-driver.snapshot.ts
pnpm run build
pnpm exec tsc -p tsconfig.host.json --noEmit
pnpm run doc-sync
python3 .local/world-completion/c16-external-shared/verify-fixture-evidence.py
python3 .local/world-completion/tmp/c16-verify-current-evidence.py
```

[当前输入 hash](c16-final-input-hashes.json)覆盖当前生产源码与编译 JS；[独立 root 核验](c16-root-verification.json)重新读取全部原件而非只相信测试 stdout。初始失败与修复日志保留在项目 `.local/world-completion/tmp/c16-*`：一次单测声明经 lint 修复为 const 后造成赋值失败，已恢复为可变局部声明；最终 115 项复验通过。fixture 早期调度和原件断言失败保留，冻结文件的最终 source／lib 全矩阵替代它们；不把早期失败算成通过。
