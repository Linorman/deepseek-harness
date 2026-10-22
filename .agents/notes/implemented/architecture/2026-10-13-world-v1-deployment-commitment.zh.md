# Agent Note: 完整 World v1 部署承诺

Status: implemented

[English](2026-10-13-world-v1-deployment-commitment.md) | 中文

## 问题

有效限额无法重建用户复核过的默认值与上限。显式请求值之上的变化可能不改变有效数值。从有效限额或虚构的模板默认 Persona 重建保留目录也会丢失原部署决定。Host Team 限额与场景配置限额具有不同的所有者。

## 决策

[compiler 版本 7](../../../../packages/simulation/simulation-scenario/src/v1-compiler.ts) 保留完整严格的 `catalog` 和独立 `teamCeilings` 观察。目录保存 Native 设置、profile/模型版本、完整模板/默认 Persona、策略、领域 implementation/generation pin 以及每项配置默认值/上限。没有 Host Team 观察的纯编译明确保存 null。公开创建所有者在元数据 IO 前观察真实 Team 上限，随后再次核对，并将其传入编译而不覆盖配置目录。

有效 Team 限额使用配置与观察上限中较严格者；显式超额请求在命令受理前拒绝。已复核预览 hash 覆盖完整 resolved 产物，包括默认值、未使用元数据与两类上限来源。即使最终有效限额相同，变化也影响承诺。可移植定义 hash 独立于部署元数据。

[私有 parser](../../../../packages/simulation/simulation-scenario/src/v1-resolved.ts) 根据原目录与观察的确定性投影核对每项保留字段。[创建 parser](../../../../packages/simulation/simulation-product/src/world-creation.ts) 核验定义/预览承诺及精确 Native specification。恢复不查询新目录来补齐缺失原数据。compiler 版本不是 9 或缺少目录/观察字段时拒绝；pre-release 产物没有迁移承诺。Native stream 94 保留有限 director 准入与来源触发案件，并拒绝早期形状。

## 备选方案

**只保留有效限额。** 无法区分默认值或更高上限变化，且丢失复核来源。

**重建模板默认值。** 空选择是虚构元数据，并非实际已安装模板的默认 Persona。

**以实时限额覆盖配置上限。** 合并了独立所有者的输入，阻止后续核验原配置上限。

## 影响

私有受理产物更大；原序列化结果与日志条目限额继续适用，不提高额度。当前有效值没有变化的元数据也可能需要重新复核。公开导出仍只包含原编写定义，新运行仍须新预检。即使已安装目录变化或移除，已有受理原命令仍保留精确身份和元数据。

## 验证

[解析测试](../../../../packages/simulation/simulation-scenario/tests/v1-resolution.spec.ts) 覆盖 Native、Team、World 三组仅元数据变化的默认值/上限、独立观察上限、显式超额、可移植 hash 不变及旧/不完整产物拒绝。[产品测试](../../../../packages/simulation/simulation-product/tests/world-v1-schema.spec.ts) 在原预览承诺下拒绝只改元数据的产物。[真实 Loader 场景](../../../../examples/simulation-company/tests/world-v1-resolution.snapshot.ts) 在 JSON/SQLite 验证实际公开预检/创建、受理命令后 SIGKILL、当前目录缺失/变化、暂停冷准备以及单独计数的公开 checkpoint 恢复。

## 场景权限

原编译声明与已安装能力共同授权环境请求。模型角色文本和日历正文不能单独授予该权限。每项声明的独立请求额度限制重复调度，不提高共享 World/Agent 限额。Native 记录实际 occurrence 准入与已接受 Decision 来源；没有普通收件人的案件采用 Native 规划责任，不伪造自发通知。独立因果视图在 Session 保留原请求、计划和结果。普通通知链仍执行原消费约束。

把每个 director 目标当成角色授权会旁路任职和操作权限。要求自发 Channel 会构造通信证据，而非记录环境 trigger。因此所选约束要求显式领域选择支持，并把每次 occurrence 限定到精确 selector、作用域、目标和 business key；拒绝及取消案件不返还独立额度。共享有限队列仍服务普通角色。来源回放重建原声明/occurrence，拒绝修改或缺失的历史。

[声明测试](../../../../packages/simulation/simulation-scenario/tests/v1-director-events.spec.ts)、[Native 来源测试](../../../../packages/simulation/simulation-local/tests/world-bootstrap.spec.ts)和[真实 Agent 场景](../../../../examples/simulation-company/tests/world-director-events.snapshot.ts)分别负责严格能力/额度/拒绝、来源完整性、普通服务及冷回放覆盖。
