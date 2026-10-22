# 当前 UI 浏览器与交互验收

2026-10-16。保留既有UI改动，修复两个可复现问题；不改变业务权限、状态机、额度、超时、断言或既有跳过项。原112项清单没有新增条目。所有脚本、构建和证据均在项目内，主目录为 `.local/world-completion/ui-current-20261016/`。

## 修复与保留失败

1. 作者表格的操作列以空行号拼成“编辑第 行”。现使用完整中英双语“行操作 / Row actions”；真实浏览器断言可访问列标题存在。
2. 预览栏长额度键名占据max-content列，令100显示成三行。仅把预览键值列改为共享宽度，并保持数值单行。真实Range测量红测为3行，修复后两后端×1440/390×浅深主题均为1行。没有改变额度数值或裁剪字段。

旧浏览器定位把页头与空状态的两个“新建世界”当作唯一控件，并仍把空白入口当radio。按实际页面改为页头按钮及原生“从空白开始”按钮，保留原键盘激活和全部业务断言。一次错误的创建按钮装饰符试定位已撤回，真实“创建暂停运行 ▸”标签仍被验证。所有失败日志/截图保留。

首轮build和全GUI检查遇到沙箱listen EPERM；在允许localhost监听的环境执行原命令后通过，不把环境拒绝称为产品回归。原页头定位首次运行与首轮构建结束有重叠，仅作为诊断；最终流程均在成功构建后执行。

## 当前证据

| 范围 | 结果与原件 |
| --- | --- |
| 核心流程 | 公司、实验室、协会×JSON/SQLite，6案通过；browser-commands.json记录准确命令、时间和退出码 |
| 业务与恢复独立审计 | audit.json / audit-core.py：168份原件hash；每票来自实际accepted Decision、独立Session及冻结正文；每案单一create/checkpoint/restore；原world/entities/relations/resources/decisions/operations/commitments冷恢复完全相等 |
| 模型边界 | 完整流程合计954次scripted模型调用，证明真实Agent/三工具链；冷读取/恢复0模型、冷读取0可写open。真实模型质量另由已有R08证据承担，本轮无付费调用 |
| 作者与交互 | 最终作者2案通过；JSON/YAML/模板/空白入口、完整定义往返、坏引用精确定位、未完成编辑保留、F2/Enter/Escape/Tab、选择器viewport及hit-test、原值与焦点恢复、源码退出、双击单一创建、导出和reload不变 |
| 响应式/主题/动效 | 两后端各覆盖1440×1000和390×1000、light/dark、reduced-motion；无页面横向溢出，创建按钮可达，运行中动画为0，额度数字单行；截图在ui-audit.json逐项列出 |
| 人员管理与故障 | 14案通过：调岗/离职/已有人员录用、丢失回执/断网/返回/第二标签原命令、缺执行provider恢复、未结交接、未知退休持有原身份和容量；16份proof归属14个独立case，0额外模型/读取open |
| 读取生命周期 | 2案通过：握手前不读取、旧响应退役、HTTP失败保留并标记stale、断线重连、真实Loader卸载重挂载；原Native状态不变、0新owner、私密正文不复活 |
| 全GUI门禁 | 424文件，5498通过/1原有跳过，退出0；gui-final.log。包括当前全部client/host测试，不将预期拒绝测试的console堆栈误报成浏览器错误 |
| 构建与静态 | 最终build-layout.log退出0，197 Client artifacts；Host/Client aggregate types、scoped lint通过；premium-final.json严格审计零问题 |
| 文档 | doc-sync-lifecycle-final.log：生命周期迁移与链接修复后29/29通过，退出0 |

完整24个浏览器样本在当前功能代码上通过。最后的CSS修改只作用于作者预览的`.preview .keyValue`，由最终双后端作者流程再覆盖；其他交互和运行检查器规则未变。公司/实验室覆盖治理→制度→新人→独立代表→调岗→非空交接离职；协会按原定义覆盖独立委员会批准、已有人员录用和两次模拟外部询问，不宣称其定义包含全部人事步骤。

## 页面与视觉复核

使用仓库已有Playwright/Chromium，Browser插件及browser技能未提供。测试连接每案真实认证的`http://127.0.0.1:<临时端口>`，页面title非空、URL与Host一致，真实模块和业务内容可见，无Vite错误覆盖层。作者及完整流程的pageerror/console error/warning均为空。读取故障用例仅允许注入断线的已解释重连提示。

人工查看了真实目录/选择器、桌面预览、390px深色抽屉及修复前后额度截图：沿用现有视觉体系，按钮、字段、焦点环和数字可读；选择器不被滚动表格裁切，底部检查结果按钮可操作。浏览器断言与截图相互补充，不以静态premium审计替代交互。

## 输入一致性与复用范围

inputs-verification-start.json在最终流程开始期间记录999项UI/runtime owner与实际产物；inputs-final.json、inputs-final.tar.gz和archive-verification.json记录验证后的准确输入并逐字节校验归档。中间仅4项预期变化：额度CSS、其lib/client.js产物、作者几何断言、完整流程proof字段的纯换行。后者已按去除空白的文本证明无行为差异；其余全部输入一致。不是整个Host传递闭包的归档，也不冒称首个样本开始前已经完整冻结。

已有R11/R06/SDK与真实模型证据继续按owner复用：本轮没有更改Native/Team/Session协议、业务owner、SDK源或持久版本。此前已修复的测试轮询及文件资源调度有同一3670用例集合3669通过/1原有跳过的证据。本次补齐的正是旧浏览器输入不能覆盖的当前UI差额。

## R13 与边界

验收覆盖原三领域本地MVP，不扩张到Post-MVP路线或更广完整真实模型故事/可复用计费服务。Chromium、两个指定视口和已记录交互通过；未冒称全浏览器、全部辅助技术、所有屏幕尺寸或通用模型可靠性。未发布PR，因此GUI PR的真实模型GIF条件未触发。

当前必需运行验证、最终29项文档门禁与链接核验均已通过。用户明确授权生命周期迁移后，原MVP提案已转为implemented，原中英说明及侧车备份保留于before/proposal，现有引用链接已修复；更广durable coordination与视觉层路线保留自身状态。仅将原R13由未勾选改为勾选，清单112/112；没有追加清单项或证据表行。
