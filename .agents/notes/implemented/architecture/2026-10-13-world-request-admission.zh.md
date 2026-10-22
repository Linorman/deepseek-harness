# Agent Note: World 请求准入

Status: implemented

[English](2026-10-13-world-request-admission.md) | 中文

## 问题

岗位或组织终止后，未改变的 assignment 关系不能证明当前任职；permission 关系也不能通过失活端点授权新工作。若招聘制度仅在预留时检查，超出当前岗位白名单的请求仍会建立案件。预开的 intent 不能绕过首次实际请求的当前准入检查。

## 决策

[核心请求准入](../../../../packages/simulation/simulation-local/src/world.ts)从 Native 实体、当前作用域任职、已安装操作 pin 和实际 permission 关系派生权限。任职岗位和组织必须 active 且 noncognitive；授权端点必须仍 active，并符合原声明关系类型。profile 声称的角色、模型提供的身份、Session 或 proof 均不能替代这些来源。

[招聘准入](../../../../packages/simulation/simulation-local/src/world-hire-approval.ts)核验全部当前有效 validated 制度的岗位白名单。availableAt 和 audience 约束披露，不代替硬授权；未来制度和 advisory 不执行此限制。生成招聘还核验实际 active、noncognitive 的目标岗位与组织。尚无 accepted request 的预开 intent 在首次目标提交时重新经过领域准入；精确已接受 request receipt 保留原语义。

新目标候选事项重新准入时不传 `original`；只有权威 Native 前缀中已经保留的 intent 才能作为原件，虚拟候选项不是持久执行证据。人员领域继续精确核验预开事项及执行所用的原件。

委员会审批仍绑定唯一已接受请求，在 reserve 和 commit 检查。如果建立请求前就要求该审批，会形成循环前置条件。制度拒绝使用固定原因，不暴露私密制度正文或身份。模型可以放弃被拒绝的提案，通过普通工具提交零效果。

## 考虑的替代方案

**只信任关系日期。** 有效区间可以长于端点生命期，使历史关系看似仍能授权新工作。

**只在创建身份时检查制度。** 越界请求本身已产生案件和私有通知职责。

**把所有 receipt 重试当新工作重验。** 这会将已接受原件的对账变成第二次业务准入，破坏幂等。

## 影响

Native stream 94 拒绝旧流，不静默改变其请求准入解释；Compiler 9 不变。双后端测试覆盖生命期撤权、身份/profile 伪造、预开 intent、私密有效制度及精确 receipt 重试。真实 Loader 场景证明被拒请求没有 World 案件或资金效果、不披露私密制度正文，并保留持久工具失败证据；正向场景仍在建案后获得独立审批、仅录用一次并经冷恢复。
