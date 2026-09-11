# Agent Note: Team 草稿配置控件

Status: implemented

[English](2026-09-06-team-draft-configuration-controls.md) | 中文

## Problem

Web 产品从常驻的无 Session composer 创建 Team，但项目目录、模型和 Agent preset 控件分别落在未使用的旧 Workspace slot、只面向已有 Session 的模型界面和设置页。用户可以输入文本，却无法在 Team admission 前选择执行上下文。

## Decision

待创建 Team 草稿存在时，Team 侧栏显示紧凑的 Workspace 面板。面板通过 Host 目录选择能力选择文件夹，把它注册到持久 Workspace 名单，并把路径保存到本地草稿。Team 摘要保留该路径，侧栏按 Workspace 将 Team 放到文件夹下，并提供在同一目录创建下一个任务的直接操作。`team.start` 在同一个可重试请求中携带 `cwd`，再接纳首条 human 文本。模型和思考强度由聊天界面的选择器负责，coordinator 使用部署设置中的 Agent preset 默认值。

## Alternatives considered

**在 Workspace 面板中选择模型和 preset。** 放弃，因为聊天模型选择器已经负责模型／思考强度，Agent preset 设置行已经负责默认组装；重复控件会产生相互冲突的启动状态。

**复用旧 Workspace picker slot。** 放弃，因为随附 Web 使用 Team 作为产品身份，而 Team-first shell 不渲染该 slot；注册它会让控件与 Team start payload 脱节。

## Consequences

浏览器复用现有 authenticated Host 目录能力和 Workspace registry。选择的路径在首次 start 前只存在于本地草稿，Host 接受 start 后写入 Team rules，用于重启后的分组。聊天模型／思考强度控件和 Agent preset 设置仍分别是唯一的选择入口。

## Testing

客户端 runtime 和 UI 的聚焦测试覆盖草稿传递、Workspace 分组、目录选择、可重试的 start payload 以及一键继续输出。对真实 Web 服务执行 authenticated Playwright 流程，验证了目录流程并检查了最终的 `team.start` JSON 请求。
