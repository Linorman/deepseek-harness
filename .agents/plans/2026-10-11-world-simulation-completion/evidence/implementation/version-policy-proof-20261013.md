# B05：可执行的场景、持久流与 SDK 版本策略

2026-10-13，Asia/Tokyo。完成B05，清单82/112，无新增items。Native当前stream91，完整v1 resolved compiler9；原v0作者输入仍由其独立有限API明确支持，不将旧持久artifact解释为新格式。

## 当前规则与验证

`clocky.world/v1`严格作者入口拒绝v0、v2与未知版本；已有v0入口保留原声明能力，不是v1解析失败后的自动fallback。[retained parser](../../../../../packages/simulation/simulation-scenario/src/v1-resolved.ts)仅接受compiler9及完整原定义/catalog/独立Team观察；旧值不补默认、不查新catalog来重建丢失历史。新增测试使用完整合法resolved逐个改为0–8、10、future，验证错误确实定位compilerVersion；实际source/lib Loader也各执行11种原件拒绝和3种作者版本拒绝。

[实际Loader版本场景](../../../../../examples/simulation-company/tests/world-version-policy.snapshot.ts)从当前真实run的LogStream descriptor取得版本。JSON/SQLite×source/plainNode lib四PID各建立93种旧/未来stream（0–90、92、99），分别调用纯inspect与writable open。共744次拒绝均为稳定 `StorageError.code = version-mismatch`。每次拒绝后重读原stream，cursor仍为0、原run/created记录不变；没有新业务效果或模型调用。当前合法stream的paused原件精确重开成功。

四格另在当前stream中加入未知必需记录，inspect/open共8次拒绝；拒绝后tail与完整原两条记录不变。它不会被当成成功事件，也不会伪造缺失来源或迁移旧世界。全部四PID模型调用0、模型池active0。[独立审计](version-policy-audit-20261013.json)保存8份原件、完整refusal矩阵、错误类别、runtime真实source/lib路径、PID和准确启动命令。2594份相关source/lib/测试及Python输入保存于 `.local/world-completion/b05-version-policy/inputs`；26,010,755字节，`manifest91.json` SHA-256为 `eb67c95b7482551551f6456ebc31278c5578c528079dd2c433d3d3e5917d10c8`，非全仓发行冻结。

双SDK消费已知严格Session事件。未知必需事件以及false/字符串ignorable标记抛 `SdkProtocolError`；只有显式布尔true的未知事件可从typed transcript省略，并保留原raw notification。TS有实际stdio的拒绝与省略/原件保留测试；Python有相同策略测试，本轮另向共享wire corpus追加三种未知必需事件，两端真实stdio都拒绝。未知opaque领域结果的受控JSON观察不等于执行其必需Native事件；schema/reducer/provider缺失的全部可写checkpoint矩阵仍归P16/R02。

场景README和四份当前Agent Note的双语版本说明按实际91/9维护，旧证据和归档不改写。生产版本准入逻辑已具备，本部分补足完整拒绝测试与真实组合证据，没有加入迁移shim、修改原额度或启用真实provider。

## 命令、结果与失败

所有命令在项目根运行，环境统一为 `TMPDIR="$PWD/.local/world-completion/tmp"`；Python另有 `PYTHONDONTWRITEBYTECODE=1`。原件、初轮失败和最终日志均位于 `.local/world-completion/b05-version-policy`，较早探索日志为 `.local/world-completion/b05-version-*.log`、`b05-protocol.log`与`b05-python.log`。

```sh
pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-version-policy.snapshot.ts
CLOCKY_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-version-policy.snapshot.ts
pnpm exec vitest run packages/simulation/simulation-scenario/tests/v1-resolution.spec.ts packages/simulation/simulation-scenario/tests/v1-compiler.spec.ts packages/sdk/client/tests/simulation-world.spec.ts
pnpm exec vitest run packages/sdk/client/tests/sdk-client.spec.ts -t 'wire payload validation'
PYTHONPATH="$PWD/python/sdk/src" .local/world-completion/c29-public-v1/python-env/bin/python -m pytest python/sdk/tests/test_simulation_scenario.py python/sdk/tests/test_simulation_scenario_v1.py --basetemp .local/world-completion/b05-version-policy/python-tmp -o cache_dir="$PWD/.local/world-completion/b05-version-policy/pytest-cache"
PYTHONPATH="$PWD/python/sdk/src" .local/world-completion/c29-public-v1/python-env/bin/python -m pytest python/sdk/tests/test_channel_view.py --basetemp .local/world-completion/b05-version-policy/python-wire-tmp -o cache_dir="$PWD/.local/world-completion/b05-version-policy/pytest-cache"
pnpm exec tsc -b tsconfig.host.json tsconfig.client.json
node --import tsx scripts/run-oxlint.ts examples/simulation-company/tests/world-version-policy-scenario.ts examples/simulation-company/tests/world-version-policy.snapshot.ts packages/simulation/simulation-scenario/tests/v1-resolution.spec.ts
pnpm run doc-sync
python3 .local/world-completion/b05-version-policy/audit.py
```

最终source/lib各2项、协议/SDK策略39项、TS wire82项、Python策略/作者15项及wire79项通过。Host/Client类型与scoped lint通过；doc-sync在修正测试类型后29/29，最后README数字修正的五组双语配对检查通过。lib使用F07完整build的实际包产物；本部分只有测试及文档变化，未声称另一次全build或SDK wheel安装。

保留初轮失败：SQLite readonly诊断为“stream format does not match”，原测试误按message必须含version判断；现严格检查已有稳定错误类别，没有改产品或放宽拒绝。测试使用未解析的spec导致Branded时间/ID类型错误，已通过正式parser取得spec；conditional backend推导与optional log capability引发类型错误，已显式标注record/backend及检查实际log能力，不引入any。相应doc-typecheck/lint失败随后修复，门槛不变。

本项不替代P01/P16、U12/U13或R01/R02/R06/R11；尤其未验证安装后的SDK发行、所有缺provider的checkpoint或真实模型质量。所有输出均在项目中，未新增subagent或发布动作。
