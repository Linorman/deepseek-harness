# Web 稳定性与默认 Simulation：开发执行记录

本记录落实[实现决策](../../notes/implemented/architecture/2026-10-07-web-runtime-stability-and-default-simulation.zh.md)。工作包的逐项验收与确切证据由 [checklist](checklist.md)持有。基线为 2026-10-07 的受检工作树及 http://127.0.0.1:3080；开发顺序为 W00–W07，由当前执行者完成，没有启动 subagent。已有未提交工作保留，未创建提交或 PR。

## 1. 交付范围

普通 `clocky web` 的标准 bundle 安装 Team 和 Simulation 两个同级工作区。导航立即提交，设置使用公共原生模态，空闲环境装饰保持静态，明确认证失效停止保护读取。Simulation 使用真实模板、原生所有者、本地 SQLite 和专用 actor 预设；无模型时可浏览、填写草稿和进入设置，配置就绪后明确创建暂停世界，独立启动才推理。

已有标准 profile 在下次正常启动继承更新后的 bundle，不改写 manifest 或用户 patch。已有自定义根目录、日志与数据保留；接管前明确关闭 `web-simulation`。Headless 不加载该 Web group。模型驱动运行、确定性离线演示、自动恢复、隐式迁移与替换引擎保持各自范围。原 [Web 重构](../2026-10-02-web-ui-redesign/development-plan.md)及[可视化](../2026-10-04-swarm-and-world-visual-layer/development-plan.md)的独立未完成范围不由本记录宣称完成。

## 2. 工作包与当前所有者

| 工作包 | 交付行为 | 代码与长期回归所有者 |
|---|---|---|
| W00 | 原构建真实 native 导航超时／Settings 命中失败；隔离认证与规模数据 | [runtime-stability](../../../apps/web/tests/runtime-stability.e2e.ts)、[认证生命周期](../../../apps/web/tests/authentication-lifetime.e2e.ts)、[有界规模](../../../apps/web/tests/runtime-reading-scale.e2e.ts) |
| W01 | 返回前同步提交；视觉失败、中断与延迟回调不重放；前后退保留目标 | [view-transition](../../../packages/client/ui-viz/src/motion/view-transition.ts)、[生命周期单测](../../../packages/client/ui-viz/tests/transitions.client.spec.ts)、[Team 草稿历史](../../../apps/web/tests/team-action.snapshot.ts) |
| W02 | 公共 Portal/native Modal、焦点循环、分类 slot、全宽窄屏与逐层 Escape | [SettingsRoot](../../../packages/client/ui-settings-general/src/client/SettingsRoot.tsx)、[Modal](../../../packages/client/ui-primitives/src/Modal.tsx)、[设置浏览器](../../../apps/web/tests/settings-chrome.e2e.ts)、[目录流程](../../../apps/web/tests/workspace-management.e2e.ts) |
| W03 | 静态环境、实际曝光决定动态效果；终止认证仅清退一次，明确重查一轮 | [ui-viz](../../../packages/client/ui-viz/README.zh.md)、[connection](../../../packages/client/connection/README.zh.md)、[空闲](../../../apps/web/tests/runtime-idle.perf.ts)、[默认成本](../../../apps/web/tests/runtime-default.perf.ts) |
| W04 | 已安装结构与 live 模型就绪分离；确认路由、队列受理冻结、原请求协调 | [模型解析](../../../packages/simulation/simulation-product/src/template-model.ts)、[产品契约](../../../packages/simulation/simulation-product/README.zh.md)、[TS SDK](../../../packages/sdk/client/README.zh.md)、[Python SDK](../../../python/sdk/README.zh.md) |
| W05 | 标准 Web 默认安装；真实采购模板／原生工具角色／保守边界；升级与关闭明确 | [bundle](../../../packages/bundle/web-app/README.zh.md)、[生产 patch](../../../packages/bundle/web-app/cordis.patch.yml)、[profile 验证](../../../packages/boot/app-boot/tests/default-web-simulation.spec.ts)、[预设](../../../apps/cli/config/agent-presets/simulation-company/agent.cordis.yml) |
| W06 | 三入口、无模型恢复操作、保留草稿／重新预检、暂停创建与明确启动／恢复 | [工作区](../../../packages/client/ui-simulation/README.zh.md)、[模型设置返回](../../../apps/web/tests/simulation-model-setup.e2e.ts)、[默认执行](../../../apps/web/tests/default-simulation-lifecycle.e2e.ts)、[独立进程恢复](../../../apps/web/tests/default-simulation-restart.e2e.ts) |
| W07 | 来源／构建／安装入口、完整 Web replay、SDK 双端、性能与文档门禁 | [checklist](checklist.md)、[测试说明](../../../docs/testing.zh.md)、[预推送检查](../../skills/dsh-pre-push-checks/SKILL.md) |

M1 的稳定性行为、M2 的安装与就绪边界以及 M3 的真实流程分别拥有上述回归。逻辑导航不再等待浏览器捕获；可选捕获可能看见已提交视图，不承诺旧新元素变形。Swarm 自动保存位置不取消目标授权，拓扑高度随视口收敛，公共浮层保留自身输入范围。

## 3. 默认配置与不可变边界

配置的稳定身份、SQLite 根、目录／命令流、模板额度与计时值以 [bundle README](../../../packages/bundle/web-app/README.zh.md)和[生产 patch](../../../packages/bundle/web-app/cordis.patch.yml)为权威。本地模型池并发 1、排队 16，沿用 50ms 有效推进、1000ms 重试观察和 2000ms watch 轮询。原生工具定义属于角色预设，普通 agent 的全局目录保持空白。

安装模板使用显式路由或 `agent-default` 选择器。元数据预检不推理，结构损坏仍拒绝加载。没有默认模型或提供方暂缺只改变 `ready`／`needs-model`／`unavailable`；不自动选择目录第一项。公司 driver 不静默丢弃显式推理强度。`expectedModel` 在受理队列位置再次验证，改变路由要求重新确认；受理后冻结原 driver／spec／template。同 commandId 重试先协调原结果。确认字段从冻结 driver 重建，命令日志仍为 format 2，不进行隐式兼容或迁移。

创建完成初始完整检查点后保持暂停。Pause 区分停止新准入与在途工作；查询、刷新、冷启动、元数据验证和显式恢复均不恢复推理，只有新的 Start 准入。零模板报告部署问题，禁用能力深链可返回 Team。

## 4. 验证证据与环境边界

[checklist](checklist.md)记录每次实际命令、退出状态、测试环境与修复后复验；早期失败记录保留，不替代最终通过证据。最新完整稳定产物 Web 回放为 104 文件／305 项通过，1 文件／14 项按原条件跳过；跳过的是真实提供方、仅录制模式与无 PowerShell 条件，不是默认产品流程验收。

导航与设置使用真实浏览器 API、可信点击、elementFromPoint、Tab／Shift+Tab、native 400% 缩放与嵌套关闭验证。性能分别记录 SwiftShader 和 Apple M4 Pro Metal；每种默认关闭／开启对照各 30 次隔离启动和 30 秒空闲，100 次设置生命周期、100 条持久目录、500 回合历史和 20 次模式切换检查资源有界。颜色对比测量由浏览器归一化 CSS Color 4，维持原 4.5／3 标准。Headless 不作为设备 FPS 证据。

源码与构建入口共用真实 profile/bundle；默认回归不注入用于开启 Simulation 的 overlay，仅替换外部模型为可计数 replay。SDK 的 JSON／SQLite stdio 进程快照、严格 DTO 与拒绝分支各有证据。最终发布 tarball 的隔离 consumer 位于项目内部以满足用户产物约束，解析边界拒绝所有 consumer 外文件，证明不依赖 checkout。所有日志、截图、临时存储、缓存与编译产物保留在项目中。

运行中的 3080 进程保持原所有权：只读 smoke 验证原生导航约 142ms、Settings 命中和关闭、无页面异常。该进程的旧组合没有 Simulation 且新浏览器需要 handoff；新标准组合通过独立正确认证进程验收，不混用 cookie，也不静默中断用户工作。既有进程通过正常重启更新组合。

## 5. 文档归属与交接

当前行为由实现决策、受影响 README／JSDoc、[DESIGN.md](../../../DESIGN.md)和上述回归共同持有。原登记、授权、持久身份与恢复决策继续 active 并互相链接；局部替换默认部署不归档独立所有权理由。提案式正文已转为当前执行记录，最终文档门禁与逐项状态以 checklist 为准。

本次只交付工作树开发，没有请求或创建 GUI PR；GIF 发布规则不适用，后续 GUI PR 仍须记录真实服务流程。所有模型行为证据明确标为 replay，不作为真实远程提供方可靠性的证明。
