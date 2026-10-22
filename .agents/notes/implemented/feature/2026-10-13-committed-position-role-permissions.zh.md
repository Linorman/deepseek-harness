# Agent Note: 授权随实际提交的岗位任职安装

Status: implemented

[English](2026-10-13-committed-position-role-permissions.md) | 中文

## Problem

声明的岗位权限必须跟随实际任职人物。准备新身份尚未建立雇佣关系，确认私有 Channel 也不等于建立 World requester 索引。新人需要原 committed 岗位授权和 canonical 通信路径，才能安全提出自主请求。

## Decision

Native 在生成招聘、既有人物录用或调岗的完整业务 fold 保存实际 assignment/result 后，从原 World 声明安装岗位 Relation 和 operation grant。共享纯 installer 核对原 accepted intent/plan、所属 committed reservation 或 mutation、人物 binding、实际任职和精确声明的 operation 映射。模型不提供角色、人物、关系或权限。调岗保留 `world-role-authority:<intent>:<index>` 确定性 key；招聘遵循同一所有权规则，不虚构 personnel fence 或 generation。

生成与既有录用在同一业务 append 索引已经确认的原 canonical 私有 director Channel。已有一致索引保持不变，外来或模糊来源拒绝。准备阶段不授权，不分配第二 Channel 或替换身份。

精确业务重试返回原结果，不重复 grant、再次付款或重新打开已结束关系。离职继续由 personnel owner 关闭原派生岗位权限。共享代码不做 IO，保留独立费用预留/结算逻辑。Native 日志格式 91 拒绝更早格式；portable v1 compiler 保持当前结构及版本 9。

## Alternatives considered

**准备阶段安装授权。** 未解决或已取消身份会在任职和费用提交前获得雇员能力。原 committed 业务记录是最早合法授权点。

**模型选择权限或另建 director Channel。** 名字和模型输出不能证明权限或 canonical sender 所有权；原岗位声明及确认拓扑才是依据。

**各 owner 保留独立 grant 循环。** 招聘和调岗容易在映射与重试行为上分歧。一个纯 installer 核对实际所属来源，各业务 owner 保留提交与清理责任。

## Consequences

新人仅能通过原私有 Channel 提交实际岗位声明的操作。改变或外来来源阻止完整 append，不暴露部分授权。撤权后的岗位关系继续作为历史保留；不自动替换权限/身份来修补错误记录。

双后端 owner 测试执行两条真实招聘路径：准备阶段没有派生 grant，提交安装原映射，真实 World 请求保留 canonical 私有 post，模拟期限拒绝新请求，精确提交重试保留历史。外来角色关系及替换结果身份被拒绝。六文件窄回归共 103 个测试通过。完整世界 actor 行为及冷故障恢复由独立证据验证；本改动不宣称新增收费招聘 SIGKILL 覆盖。
