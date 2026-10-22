# H05 当前 UI 验收

2026-10-20，source Host / built Client，真实认证 HTTP 与 WebSocket，JSON、SQLite 两后端。Browser plugin 不可用，使用仓库 Playwright Chromium。测试、运行数据、截图、编码及解码产物均在本项目中；准确命令、247 个 UI 相关源码 hash、34 个构建产物 hash 和 43 份原始证据 hash 见 [UI 登记](ui.json)。本轮仅增强既有浏览器测试，未修改产品逻辑或新增 checklist 项。

| 验证 | 结果 | 原件 |
|---|---|---|
| 作者工作台、日历、Persona 人工审核 | 两后端 2/2 通过；真实草稿 CAS 冲突、字段对比和恢复，保存布局重开，模板导出，暂停运行创建，日历未知结果经刷新后重试同一 payload，人物草稿审核/退回/重新生成/版本对比；0 模型调用，浏览器无 warning/page error | [最终浏览器日志](ui-author-final.log) |
| 治理影响、权限与来源跳转 | 两后端 2/2 通过；真实双委员会路线和未完成义务，无内容授权时隐藏，单独 case 授权后显示、撤权后移除，跳转原决策；0 可写打开、0 模型调用、无 console error | [双文件首次日志](ui-browser.log) |
| 键盘与等价列表 | Space 选择组织图，Enter 选择列表对象，Tab 到 Y 时具备 `:focus-visible` 且包围输入的边框实际变色，Tab/Enter 提交布局；390px 列表可滚动到达并通过 Enter 选择，保留原坐标 | [JSON 呈现证据](ui-author-json-presentation.json)、[SQLite 呈现证据](ui-author-sqlite-presentation.json) |
| 窄屏、主题、减少动效 | 1440×1000 与 390×844 各验明/暗主题；实际 `color-scheme`、body 主题属性和不同背景色匹配，横向溢出 0；reduce 时检查栏 transition 为 0s，工作台没有运行中的动画。桌面、窄屏和窄屏焦点截图已目视核查 | [呈现及截图 hash](ui.json) |
| 状态和失效响应 | 9 文件、47 项通过；覆盖空/未发布、错误/重试、加载、陈旧、未知结果原命令重试、旧预检/读取响应失效、人物对比撤权后清除及日历私密正文拒绝 | [31 项](ui-components.log)、[16 项](ui-state-components.log) |
| 单文件 lint | 通过 | [lint](ui-lint-final.log) |

最终本地 GIF 为 `.playwright-mcp/world-post-mvp-final-acceptance.gif`，同一次 SQLite 运行的 6 张连续状态截图：草稿保存、组织图、冲突、载入已存版本、日历完成、人物版本对比。编码结果为 1200×834、12 秒、120 帧、759506 字节，SHA-256 `6886c19ad1739070eb1956b0b6e90be1ff9fc65b81c71ae83e1418e960b4ab26`。已解码并目视核查首帧、冲突帧和末帧；编码摘要见 [GIF 原件](ui-gif-encode-final.json)，运行来源见 [SQLite provenance](ui-author-sqlite-provenance.json)。

GIF 使用真实服务和独立项目内数据，部署装有 scripted 测试 provider；所演示的创作与人工审核没有推理，不构成真实 provider/model round 演示。本次未创建 PR 或发布 GIF，保留为本地可审阅证据。`record-browser-gif` 对 GUI PR 要求真实模型回合；当前零推理证据不能被重新标记为满足该 PR 规则。

首次作者浏览器失败源于新增测试错误要求原生 input outline；实际 Input 使用包围元素的 `:focus-within` 边框。原失败日志保留在 `ui-browser.log`，未计为通过；修正为实际焦点样式后，[聚焦复验](ui-author-current.log) 和最终含窄屏列表的复验均通过。原有 A1–A3 验收登记存在源码 hash 漂移，本报告使用本轮原件；未发现本轮范围内需要修改产品逻辑的 UI 缺口。

本报告支持 H05 所交付 UI 的本地验收，不扩展为 C15/C16 的人工质量评分或 E 组真实 provider/生产资格，也不替代总验收的构建、类型检查与文档门禁。
