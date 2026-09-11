# @clocky/clocky-command-team-goal

[English](README.md) | 中文

`@clocky/clocky-command-team-goal`只会为 Session header 命名有效 Team 的 live Agent 安装 scope 内的面向用户 `/goal` 命令。它通过 `ctx.teams`读取 Team 所拥有的目标；它绝不创建 Session 所有的 Goal，也不接受调用方选择的 Team 或 participant。Session header 是路由 provenance，不是已认证 actor，因此目标 mutation 要等待产品 Actor Proof control plane。

## 命令

| 输入 | 效果 |
|---|---|
| `/goal` | 显示当前 Team 目标、phase、存在时的 blocker、goal budget 和 mutation 的 authenticated-actor 要求。 |
| `/goal edit <objective>` | 在已认证产品 actor 可以请求目标 mutation 前拒绝。 |
| `/goal pause` | 在已认证产品 actor 可以请求 phase transition 前拒绝。 |
| `/goal resume` | 在已认证产品 actor 可以请求 phase transition 前拒绝。 |
| `/goal complete` | 在已认证产品 actor 可以请求 phase transition 前拒绝。 |
| `/goal block <code> <message>` | 在已认证产品 actor 可以请求 phase transition 前拒绝。 |

该命令有意不提供 create、clear 或隐式替换形式：每个 Team 都以一条持久 goal seed 开始，目标变更必须显式表达。它不接受 image attachment。

## 授权与并发

该命令只会从准确的接收 Agent Session header 派生 `TeamId`用于状态读取。它绝不会把该 header、participant id 或命令文本当作修改持久 Team 的 authority。每种 mutation form 都会返回固定的 actor-required result，且不会调用 `ctx.teams`；未来由 Host-authenticated actor proof 负责重新启用这些形式。

## 模型体验

### Team goal 命令

#### 模型所见

没有直接内容。本包不注册 prompt section 或 tool。命令 registry 会为用户交互记录普通 `command/run`和 `command/done` Session event，而 Team provider 拥有目标 journal record。

#### Token 效果

零 model token。该命令不会启动 model turn。

#### KV Cache 效果

本包不拥有 model request prefix。

## 已知限制与延后工作

- **仅限 coordinator scope**——Web Team composition 会为 live Team coordinator 挂载该 command；它不是通用 Team list 或 remote participant control surface。
- **Mutation requires product authentication**——`/goal`在 Host-authenticated Team actor 能为请求的 mutation 生成 proof 前保持 status-only。
- **不接收 attachment**——objective edit 仍为纯文本；富文本 human content 继续通过 Team channel input admission 进入。
