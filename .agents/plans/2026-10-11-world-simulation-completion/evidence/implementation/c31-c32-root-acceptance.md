# C31–C32 root acceptance

2026-10-13 Asia/Tokyo；cwd `/Volumes/projects-mac/deepseek-harness`。原 checklist 新验收 S07、U01、U02、U03，累计61/112；没有新增或删改任何验收项，目标继续进行。

## 实现与原件

初始 checkpoint 的真实存储失败保留原失败终态。新的已受理 `world-prepare` 命令从自身派生独立 checkpoint，复用原采集策略、完整编译结果、原生命周期 fingerprint 与全部 Native/Team/Participant/Session/Channel 身份。更改策略、复用失败身份、原失败前尝试及未声明的前次 checkpoint history 均在变更前拒绝；失败记录不复活。

[完整准备报告](c31-v1-preparation-proof-20261013.md)覆盖21边界×JSON/SQLite×source/plainNode lib：84格、252不同PID、84真实SIGKILL、168cold、4真实ENOTDIR。1,984原件和5,346输入/59,401,489字节副本保留，前后SHA256 `beb06512c96ad734ed54833e1cd9d747afd92b300dd842fb43e37b220a6468ce` 一致。[Root审计](c31-v1-preparation-root-audit.json)重新读取当前/副本hash、原Bootstrap全部资料、R<S、原失败及无追加的第二cold；不是复制passing摘要。

作者台的模板、JSON/YAML文件与空白定义共享完整v1草稿。复合JSON、nullable结束值、未完成文本与源码专有字段保持；拒绝编辑显示父草稿。真实浏览器发现并修复迟到rAF夺取输入焦点的竞争，修复前回归真实失败，修复后成功。公开模板只来自明确Config，不从私有run/export派生。[浏览器报告](c32-v1-authoring-browser-proof-20261013.md)保留六轮历史、两个后端的真实Loader/构建前端/HTTP/WebSocket、原创建/暂停checkpoint/零推理/重开/JSON与YAML导出，advisory和validated同时显示且正文canary不进入preview。

[最终Root审计](c32-v1-authoring-advisory-root-audit.json)读取原始JSON/SQLite Native日志、确认sole bootstrap/checkpoint、原始资料与reserved/unmaterialized Sessions，并通过plainNode lib decoder核对JSON/YAML完整定义。34原件、5,720输入/72,909,180字节副本；SHA256 `4d99852d3dfcdee85ec4bcbcc9e61b18c020becf8a9c53afc22687053d1cd870` 是明确的执行后捕获，未冒称browser执行前冻结。第五轮成功审计及副本另外保留。

## Root验证

日志均在 `.local/world-completion/c31-v1-preparation/root-tests/`，UI日志在 `.local/world-completion/c32-v1-authoring/`。对应精确browser/source/lib与静态命令见上述报告。

- `TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-product/tests/world-preparation-v1.spec.ts packages/simulation/simulation-product/tests/world-preparation.spec.ts packages/simulation/simulation-product/tests/world-administration.spec.ts`：3files/217pass，`unit-final.log`。
- `TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build`：完整Host/Client/build成功，197前端产物；最终修复输入 `build-focus-fixed.log`。
- `TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync`：最终29/29通过，`doc-sync-final.log`。新的公开配置/API目录已生成，README/AgentNote双语与pairing同步。
- `pnpm exec tsc -p tsconfig.host.json --noEmit`、Client聚合类型、scoped typed lint/JSDoc均成功；源码入口和当前已安装Python wheel均验证catalog/v1 parser。最新wheel154pass，`python-wheel.log`，`wheel-origin.json`证实导入当前安装路径。
- Simulation UI完整41files/405pass；最终真实浏览器2backend/2pass，9.37s。窄屏、浅深、减少动效与精确诊断focus实测；不代替完整U15。

文档检查后再次核对当前与完整输入副本，`.local/world-completion/c31-v1-preparation/root-tests/final-inputs-verified.json`保留两套hash一致结论。全部中间文件、数据库、截图、缓存、wheel及编译产物都在本项目；未发布或push。

## 尚未验收

U14/U15完整生命周期/领域投影仍未通过：重开World领域页面明确显示未发布，不能当作真实组织/制度/外部读取。S06的完整原始default/ceiling部署依据仍需保留；当前resolved只保留effective限额，不能把这轮准备验收当作其完成。S08、director场景授权、三场景通用剧本、SDK发行/RPC、真实provider及其余原项继续按清单处理。
