# X13：仅模拟的 API、界面和执行边界

2026-10-14，Asia/Tokyo。完成 X13，清单 84/112；没有新增 checklist item。Native stream 91，v1 compiler 9。

World 预检和运行页持续显示“外部世界全部为模拟：不访问真实网络、付款或邮件”。预检提示位于折叠详情之外；运行提示以保留的 World template ID 判断，Engine 切换和重开后仍可见，普通仿真不误标。复用现有 EN/ZH 文案与样式。真实 Chromium 已检查 1440/390、浅深主题和减少动效；人工查看了重开的运行页和 390 深色预检截图，文字完整可读。

v1 预检原有 `scope.source`、`preview.source` 保留严格字面值 `simulated-only`；有限 legacy API 的 `scope.source` 也成为必需字段。Python 与共享 TS product/protocol schema 同步，缺失字段或真实网络/付款值不会被默认补成模拟。当前业务领域读取仍显示 unpublished，本项没有宣称界面已能查询所有制度、组织或外部正文。

当前 source 与 plain Node lib 各执行公司/实验室 × JSON/SQLite × 18 个请求/计划注入，合计 144 case、288 独立进程、144 cold process。真实 URL、adapter、email、payment、credentials 以及 source/sink/resource-create 注入均拒绝原提交及精确重试。独立审计逐个核对实际 Session `simulation_stage` 载荷、`simulation_submit` tool call/result、错误原文、Native 原业务状态、库存余额、外部身份和 checkpoint；没有通过清空账本制造拒绝成功。冷重开保持 paused，模型调用为 0。合法 baseline 业务历史仍保留。

另由真实 authenticated HTTP RPC 对两个后端各注入 URL、网络 adapter、邮件、付款及凭证，10 个 API 请求全部在分配 owner 前返回 `bad-request`，没有创建 run 或模型调用；实际 v1 预检同时返回两个 `simulated-only` 字段。真实 UI 用原 command 创建 paused run，保留 canonical Team/Session 绑定，重开仍显示提示，pageErrors 为空。[独立原件审计](simulated-only-boundary-audit-20261014.json)保留准确启动参数、PID、144 case 原错误及 1,656 运行产物 hash，另包含两份浏览器原件目录与 hash。

输入位于 `.local/world-completion/x13-simulated-only/input-bytes`：5,898 份 source/lib/config/Python 文件，manifest hash `5f5d1faca0bed6019646419400aa94601ac20957a5d8ff762d09adc1a0e12c81`。副本与最终 live bytes 均独立核对。这是在最终 build 后验证期间捕获的输入清单，不声称执行前冻结。所有中间文件、Python cache、构建和截图均在本项目。

## 验证与准确命令

以下命令均在项目根，设置 `TMPDIR="$PWD/.local/world-completion/tmp"`。日志位于 `.local/world-completion/x13-simulated-only`。

```sh
pnpm exec vitest run packages/simulation/simulation-product/tests/world-schema.spec.ts packages/client/ui-simulation/tests/world-author.client.spec.tsx packages/client/ui-simulation/tests/world-creation.client.spec.tsx packages/client/ui-simulation/tests/workspace.client.spec.tsx
PYTHONPATH="$PWD/python/sdk/src" PYTHONDONTWRITEBYTECODE=1 .local/world-completion/c29-public-v1/python-env/bin/python -m pytest python/sdk/tests/test_simulation_scenario.py python/sdk/tests/test_simulation_scenario_v1.py --basetemp .local/world-completion/x13-simulated-only/python-tmp -o cache_dir="$PWD/.local/world-completion/x13-simulated-only/pytest-cache"
pnpm run build
pnpm run doc-sync
WORLD_BOUNDARY_EVIDENCE_ROOT="$PWD/.local/world-completion/x13-simulated-only/source-matrix" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external-boundary.snapshot.ts
CLOCKY_EXAMPLE_MODE=lib WORLD_BOUNDARY_EVIDENCE_ROOT="$PWD/.local/world-completion/x13-simulated-only/lib-matrix" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external-boundary.snapshot.ts
pnpm exec vitest run --config vitest.snapshot.config.ts apps/web/tests/world-v1-authoring.snapshot.ts
pnpm run test:gui
pnpm exec vitest run packages/client/ui-simulation/tests/world-author.client.spec.tsx packages/client/ui-simulation/tests/world-v1-author.client.spec.tsx --maxWorkers=2
pnpm exec vitest run packages/client packages/host --maxWorkers=2
pnpm exec vitest run packages/host/apiproxy/tests/api-proxy-teams.spec.ts --maxWorkers=1
PYTHONDONTWRITEBYTECODE=1 python3 .local/world-completion/x13-simulated-only/verify-current.py
```

Focused 149、Python 16、source 72、lib 72、真实浏览器 2 通过；完整 build 197、Host/Client 类型、10 个受影响 TS/TSX 的 scoped lint、doc-sync 29/29 通过，双语 owner 文档已配对。build-final.log 对应最后的 UI 文案节点，后续没有改产品代码。

保留初次失败：旧 ready fixture 未带必需 source 导致 2 个 focused 失败，补齐正式 contract 后 149 通过。首次全 GUI 在并发负载下有 5 个 5 秒超时；两文件独立复跑 13 通过。有限 worker 全 GUI 得到 421/422 文件、5,443 通过、1 skipped，余下 apiproxy deadline 断言和 Session forwarded-event 超时；整个 apiproxy 文件再独立复跑 89/89 通过。没有调整阈值；这里提供完整失败记录与复跑证据，不声称同一全套运行全部成功。

premium 静态审计仍有 5 个已有 textarea/select 控件问题，保留 `premium-audit-final.json`，由 U15 继续完成；本项不替代全 UI 验收。没有安装真实外部 adapter，没有真实模型实验、SIGKILL 或 PR/GIF 发布；完整恢复 provider、UI/SDK 分发和 MVP 收尾仍待 P16/U04–U15/R01–R13。
