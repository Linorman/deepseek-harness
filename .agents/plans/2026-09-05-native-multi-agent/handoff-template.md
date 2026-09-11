# 程序员交接记录模板

复制本模板到当前工作包的 PR 描述或交付记录。替换所有待填字段；保留没有执行和没有完成的事实。本模板由[总计划](overview.md)引用，不构成产品运行文档。

## 任务与版本

| 字段 | 内容 |
|---|---|
| 工作包 / 场景里程碑 | 待填 |
| 主责 / reviewer / 下游接收人 | 待填 |
| 共同基线 / 当前提交 / PR base | 待填 |
| 接口编号与本次版本 | 待填 |
| 对应 Gap | 待填 |
| 状态 | NOT_STARTED / DESIGN_READY / IN_PROGRESS / READY_FOR_INTEGRATION / VERIFIED / BLOCKED |
| 依赖及满足证据 | 待填 |

## 交付行为

写出一项具体触发、最终可观察结果、持久记录或资源处置，以及拒绝条件。列明公开 API、事件、配置、model-visible 内容和格式变化；未发生变化的领域无需罗列。

## 验证记录

| 命令或场景 | 提交 / 环境 | 结果 | 证据位置 |
|---|---|---|---|
| 待填完整命令 | 待填 | PASS / FAIL / NOT_RUN / BLOCKED_ENV | 日志、snapshot、coverage、GIF 或 workflow |

说明成功测试是否通过生产入口、是否使用真实进程、是否通过同一 Hub/Session 流，报告跳过数量和原因。记录 node、pnpm、操作系统、数据库后端、协议版本及远程 provider 版本；不要记录 secret。

## 下游接口交接

列出可以调用的方法、实际错误 code、payload/schema owner、幂等键范围、cursor/attempt/generation、取消语义、分页限制和清理所有权。链接对应源码和维护文档，不粘贴另一份会漂移的完整类型定义。

## 尚未完成

每项写明缺失行为或证据、原因、下一位责任人和可执行下一步。不能用“后续优化”掩盖原验收条件；依赖未满足时工作包保持 partial/blocked。

## 合并确认

| 检查 | 记录 |
|---|---|
| 热点文件归属和共享 schema 已确认 | 待填 |
| owning Note、README、subsystem、双语和生成结果同步 | 待填 |
| 该行为的 runnable-example snapshot 与两 SDK owner | 待填 |
| GUI 真实服务 GIF；无 GUI 变化时写不适用 | 待填 |
| 资源释放、权限拒绝和幂等重试已验证 | 待填 |
| 父提交变化导致失效的证据已重跑 | 待填 |
| 未提交 fixture、测试临时文件、secret 未进入发行 | 待填 |
