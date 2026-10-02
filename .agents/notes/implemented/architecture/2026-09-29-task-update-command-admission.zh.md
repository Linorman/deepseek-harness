# Agent Note：任务更新命令受理

状态：已实施

[English](2026-09-29-task-update-command-admission.md) | 中文

## 问题

任务编辑响应丢失后，浏览器无法区分已受理修改与未提交请求。换用新 revision 重试可能再次编辑；用户继续输入后替换原命令，会丢失已提交操作的身份。

## 决策

任务详情更新要求调用方提供品牌化 command ID。Hub 在任务 journal record 中原子保留规范化可编辑输入、精确 human 或 coordinator 作者、原 expected／applied revision 与受理时间。同当前作者的精确重试返回不可变原受理信息及明确标识为当前的任务，不再追加。作者或 payload 改变会拒绝；当前 proof 与 policy 仍须通过。`maxTaskUpdateCommandsPerTeam` 限制全部终态结果的保留数量且不淘汰，`maxSelectionBytes` 限制每份私有结果。Team journal／checkpoint format 为 38，旧格式拒绝。

通过权限与 policy 后，确定性的任务 mutation fold 识别版本不匹配、工作流归属、正在执行或无效编辑。Hub 先提交 `task/update-rejected`，再发出 `TeamTaskUpdateRejectedError`；普通解析、权限、容量或存储失败不确立终态拒绝。精确重试在条件改变后仍返回原拒绝。拒绝只更新 Team cursor 和命令账本，不改任务字段或 revision。Journal replay 按当时任务验证原因与诊断；checkpoint 保留历史结果，不按推进后的状态重新判定。

Journal 与 checkpoint 校验将 receipt 绑定到保留的 Team、任务、作者和 activation 事实。新的 journal 受理要求有效 active 权限与精确提交修改；成员离开或 activation 退役后，checkpoint 仍验证历史归属。公开受理元数据不含提交说明或 proof 材料。

精确结果查询返回 `applied`、`rejected` 或 `not-found`。Host 与 SDK reader 在 provider IO 前后校验直接或规范父 Team 权限，包括失败结果。Host 的确定拒绝响应携带原拒绝元数据。runtime 核对原命令身份，并在取消、Team 或授权替换后收回结果和诊断。已观察结果的 revision 推进 inspector 的最低 revision；再次读取失败时旧字段仍过期。查询不执行命令；未找到不能证明拒绝，也不能取消延迟请求。

查看 store 在发送前保留原 payload 与 ID。在确认原结果或用户明确丢弃草稿前，禁止新提交。明确查询／重试始终使用原输入，即使用户后来继续编辑。确认受理后保留新编辑，并要求核对当前 revision 后才创建新命令。确认拒绝后保留字段和已确定结果的原提交输入；修改字段或明确核对更新的任务 revision 后才启用新 ID。关闭与导航在既有额度内保留输入，不在查看 store 中复制服务端事实。

## 考虑过的替代方案

**用最新 revision 重试。** 这会创建另一项修改，不能确认已提交操作。

**只在内存保留 ID。** Hub 重载后无法区分重试与新更新。

**把未找到当作失败。** 延迟的原请求仍可能进入串行受理。

## 后果

有界受理可能失败且未保留结果。这类失败在查询或精确重试确认前仍是未确定。明确丢弃不会取消已提交更新。原终态元数据在任务推进与检查点恢复后保留；历史重试仍要求当前写入权限。完整授权和视觉矩阵仍是独立验证工作。

## 验证

JSON 与 SQLite 测试验证原子终态结果、拒绝时任务不变、精确重试、不同 payload 拒绝、条件推进与恢复。追加失败不产生确定拒绝；检查点失败仍保留已提交拒绝。持久输入解析测试拒绝虚构原因和错误身份、时间、作者、activation 或字段。Core／Hub helper 与草稿比较的定向覆盖率完整。Host 和 runtime 测试核对原身份并收回退役响应。TS／Python client 解析全部三种查询结果。组件和真实 Host keyless 流程覆盖直接拒绝、拒绝响应丢失、受理前原请求重试、关闭与修正后的新提交。
