# U15 键盘、焦点与响应式交互

2026-10-15；完成原 U15，103/112；未新增 checklist 项。当前任务没有创建或更新 PR，因此本条 GUI PR 的真实 flow GIF 条件尚未触发；没有用脚本模型录像冒充真实 provider 证据。真实 provider 验收继续由 B04/R08/R09 独立记录。

最终 UI/runtime owner 输入 hash：`7ba513be9f9299cf3511fe5e1875f3c16de92b21e6545a888153b0643b002860`，共 1,235 个源码、声明、实际 artifact、manifest、lock、设计规则和浏览器 owner 输入。[逐文件清单](../../../../../.local/world-completion/u15-interactions/inputs-final.json)、[归档](../../../../../.local/world-completion/u15-interactions/inputs-final.tar.gz) SHA-256 `1a6948a4a5d64173f2fe3b6de34230271fe2ce7fba39d690e940b23519027058`；[Root 独立重新读取](../../../../../.local/world-completion/u15-interactions/root-archive-verification.json)核验全部文件。不宣称覆盖整个 Host 传递依赖闭包。

## 实现与实际界面

闭合选项与引用使用同一 ReferencePicker：F2 进入编辑时保留当前非首项值；当前值位于普通 50 项前缀外时仍保留。Enter 确认，Escape 取消并返回原单元格，Tab 按网格规则移动；未匹配的闭合文本不自动提交。程序化焦点同步实际活动单元格，诊断通过 aria-invalid/describedby 关联。弹层进入最近 open dialog 或 body，由既有定位 hook 限制视口、跟踪滚动和 resize；活动选项只滚动列表内部。

textarea 明确使用 CSS module 的 resize-none 策略及既定行数／面板边界，内容内部滚动。源码区域有可见焦点框、可访问快捷键说明及 Esc 后 Tab 退出路径。实际 react-dom portal 依赖与类型已声明，lock 只增加既有版本的 importer 记录。[双语 Agent Note](../../../../notes/implemented/feature/2026-10-15-world-authoring-keyboard-controls.md)、[DESIGN](../../../../../DESIGN.md)和[UX 契约](../../../../../UX-CONTRACT.md)记录控件规则。

[真实浏览器逐文件审计](../../../../../.local/world-completion/u15-interactions/browser-audit-final.json)保存 JSON/SQLite 两个唯一 root：实际认证 HTTP/WebSocket、Loader built Host/Client，Vitest source fixture。两格均完成模板／JSON／YAML／源码、诊断定位、暂停创建、定义导出与重开。1440/390 宽度分别检查浅深主题和 reduced-motion；无横向页面溢出，创建按钮可达，减少动效时无运行中的动画。弹层四边在视口内且真实 hit-test 可达；实际键盘验证当前值不变、焦点返回和源码退出。两格均 0 model、0 pageerror、0 console error。Root 查看了窄屏弹层及深色预览截图。证据证明这些实际交互，未宣称穷尽所有辅助技术或屏幕尺寸。

## 命令与结果

所有命令均在项目根目录，使用 `TMPDIR="$PWD/.local/world-completion/tmp" XDG_CACHE_HOME="$PWD/.local/world-completion/pnpm-cache" npm_config_state_dir="$PWD/.local/world-completion/pnpm-state"`。Python 加 `PYTHONDONTWRITEBYTECODE=1`。

| 命令／范围 | 结果与原件 |
|---|---|
| `pnpm exec vitest run`，World author/typed-field/source 三 owner | [31/31](../../../../../.local/world-completion/u15-interactions/owner-portal-third.log)；最终焦点与 aria 修复后 author owner [7/7](../../../../../.local/world-completion/u15-interactions/focus-owner-final.log)，范围重叠不求和 |
| `pnpm run test:gui --maxWorkers=2` | [424 files / 5490 passed / 1 existing skipped](../../../../../.local/world-completion/u15-interactions/test-gui-bounded-third.log)，151.73s；此全量结果早于随后独立 control 查询合并修复，后者 [2 files / 50 passed](../../../../../.local/world-completion/u14-product/control-coalescing-first.log)，最终组合仍由 R11 重选 |
| `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-v1-authoring.snapshot.ts` | 最终 built Client、control 修复后 [2/2](../../../../../.local/world-completion/u15-interactions/browser-author-post-control.log)，13.11s；此前含 hit-test／console 检查的 [2/2](../../../../../.local/world-completion/u15-interactions/browser-author-final.log)保留 |
| `pnpm run build` | [最终当前构建](../../../../../.local/world-completion/u14-product/build-control-coalescing-first.log)退出0，197 Client artifacts；先前 U15 [构建](../../../../../.local/world-completion/u15-interactions/build-second.log)保留 |
| `pnpm exec tsc -p tsconfig.host.json --noEmit`、`pnpm exec tsc -b tsconfig.client.json` | [Host](../../../../../.local/world-completion/u15-interactions/types-host-fourth.log)及[当前 Client](../../../../../.local/world-completion/u14-product/types-client-control-first.log)退出0；Host 包含当时完整 browser owner，后续 fixture 变化仍在 R11 验证 |
| `pnpm exec tsx scripts/run-oxlint.ts`，变更 UI/fixture owner | [UI scoped](../../../../../.local/world-completion/u15-interactions/lint-ui-final.log)与[当前 control/browser scoped](../../../../../.local/world-completion/u14-product/lint-control-second.log)退出0；精确参数可从源码 owner 路径与保留日志核对 |
| `python …/frontend-design-premium/scripts/audit_project.py "$PWD" --mode strict` | [strict 静态审计零问题](../../../../../.local/world-completion/u15-interactions/premium-final.json)，不代替运行交互 |
| `pnpm run doc-sync` | [29/29](../../../../../.local/world-completion/r12-docs/doc-sync-second.log)，51.83s；双语 note/README/提案及生成目录已同步 |
| `python/sdk/.venv/bin/python .local/world-completion/u15-interactions/scripts/capture.py` | [冻结输入及实际 browser proof](../../../../../.local/world-completion/u15-interactions/capture-final.log)；归档和 Root 复核均通过 |

## 保留失败与范围

首轮 premium 指出 textarea 缺明确 resize 策略、原生 select 与自有选择器契约冲突；已实际修改控件。portal 初测暴露未声明 react-dom 依赖，补声明后通过。第一次 browser F2 编辑错列，修复网格活动焦点同步后通过；失败截图／日志保留。

完整 GUI 首轮的三个失败分别是旧 Obligation 测试仍把“等待”当按钮、注册 fixture 缺真实 management reader、Team 导航测试遗漏既有 envelope 清理 update。测试已对应实际契约，并保留拒绝旧响应保证，定向 [22/22](../../../../../.local/world-completion/u15-interactions/gui-refusals-second.log)。默认多 worker 的第二轮出现两个既有 5 秒超时；未加时间或放宽断言，限定 2 worker 的完整同范围回归通过。首次类型／lint／依赖解析失败均保留，不计作成功。所有过程文件、缓存、构建产物及后端原库均留在项目内。
