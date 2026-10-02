# Agent Notes

[English](README.md) | 中文

Agent Note 记录决策和提案：代码与 API 文档无法承载的决策依据、备选方案、影响和必需的验证。本文件规定其生命周期、存放位置与格式。

## 布局与命名

使用 `{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`：

- **生命周期：**
  - `proposed/`：尚未实施或只实施了一部分的工作。
  - `implemented/`：已交付的决策，在代码变更中同步更新事实；见 [implemented/AGENTS.md](implemented/AGENTS.md)。
  - `rejected/`：已否决的提案，仅当其决策依据能避免可能发生且有实质影响的错误时保留。
- **类别：**决策的种类，定义如下。

文件名日期是主题首次提出的日期，以 Git 历史为准。交叉引用使用相对 Markdown 链接，不使用裸名称或编号。浏览生命周期/类别目录树或搜索仓库即可；不要添加集中式 `INDEX.md`，它重复已有发现方式，并让无关分支争用同一个文件。

<a id="classification"></a>

## 分类

封闭的类别集合定义在 [scripts/agent-note-tree.ts](../../scripts/agent-note-tree.ts)。新增类别必须同时更新该集合与本表。

| 类别 | 覆盖范围 |
|---|---|
| `feature` | 面向用户或模型的新能力。 |
| `bug-fix` | 修正缺陷或事故复盘（postmortem）发现的缺口。 |
| `simplification` | 在不增加能力的前提下移除代码、行为或对外范围。 |
| `architecture` | 关于交付源码的结构性决策：包之间的关系与运行时词汇。 |
| `process` | 代码周边的工具、策略与工作流，包括门禁、包管理和 vendor 化。 |
| `testing` | 测试基础设施与策略。 |

`architecture` 关乎交付源码；`process` 关乎周边工具与工作流。`refactor` 与 `simplification` 重叠，因此不在类别中。

## 归档与删除

当 implemented 记录中的备选方案、归属边界、否定性保证、持久化语义或协议语义、安全规则、重新引入条件仍能指导未来变更时，保留其活跃状态。已完成且决策依据未来价值较低的记录应归档。绝不归档提案：过时提案应否决。rejected 记录不再防止可能发生的错误时，删除完整的三文件组并修复入站链接。采用 [dsh-archive-agent-notes](../skills/dsh-archive-agent-notes/SKILL.md)；时间、长度与配额都不是判据。

仅归档 implemented 记录，路径为 `archived/{class}/yyyy-mm-dd-topic-title.md`。同时移动英文、中文和伴随记录；保留 `Status: implemented`，在两侧紧接该行插入相同的 `Archived: YYYY-MM-DD`，重新记录 hash，并修复或删除入站链接。归档时不得修改其他正文。

封存的三文件组永久冻结：禁止编辑、翻译、重新格式化、更新、移动或删除，也不得作为当前权威依据。文档检查跳过归档源文件及其出站链接；活跃文档可以明确将其作为历史引用。[verify-archived-agent-notes](../../scripts/verify-archived-agent-notes.ts) 检查类别目录树、三文件组、元数据、伴随记录 hash 和仅追加的封存记录。[归档政策决策](implemented/process/2026-07-26-frozen-agent-note-archive.zh.md)记录设计依据。

<a id="when-to-write-one"></a>

## 何时需要写一份

每个非平凡变更必须在同一 PR（Pull Request）中新增或更新 Agent Note。范围包括行为、架构、共享约定、流程或工具、测试策略、磁盘存储格式、协议格式（wire format）或配置格式，以及维护者可能合理重新审视的其他决策。未来重大工作从 `proposed/` 开始；已做出的决策从 `implemented/` 开始。只有不改变行为、约定、结构、流程或理由的机械性或局部编辑才可豁免。

更新已有的归属记录，不要创建重复记录。保持其事实实现与现状一致；不同的决策需要新记录并互相链接，除非旧记录符合合并条件。

被完全取代的 implemented 记录，只有在当前归属记录保留所有独有的决策依据、备选方案、影响、必需的验证和明确指出的覆盖缺口后，才可合并并删除。在同一变更中修复所有入站链接并删除完整的三文件组。部分取代要求保留两个记录、互相链接并更新当前事实。不得把旧决策改写成其反面，也不得让 Git 历史成为其决策依据的唯一副本。

新增功能的记录只有在功能已从生产代码、配置、schema、持久化格式或协议格式、迁移和兼容行为中消失，当前文档不将其呈现为可用，且没有测试将其作为受支持行为执行时，才可合并到后续的移除记录。保留最初动机、为何该动机已不足以支持功能、完全移除之外的备选方案、放弃的能力、重新引入条件和彻底移除的验证。移除依据与验证缺失的测试可以保留；过时的实现清单和已删除行为的测试不是当前证据。只移除一种传输、默认值、实现或展示属于部分取代，任何残留的持久数据或兼容处理亦然。

<a id="the-file-format"></a>

## 文件格式

`doc-sync`（文档同步门禁）运行 [verify-agent-note-format](../../scripts/verify-agent-note-format.ts) 检查活跃记录格式。归档记录保留封存格式并加上归档日期行。

### 头部块

以以下精确三行开头，随后留一空行：

```markdown
# Agent Note: <title>

Status: <status>
```

状态必须与生命周期文件夹一致：

- `Status: proposed`
- `Status: implemented`
- `Status: rejected — <why, in one line>`

状态行不得带日期或括号说明。文件名记录首次提出日期；Git 记录后续历史。修订说明放在正文中。

### 正文骨架

以 `## Problem` 开头，不依赖解决方案说明动机。重复使用的章节采用下列规范标题；专门的技术章节可以插在其间。

#### `proposed/`

```markdown
## Problem
## Proposal
…bespoke sections…
## Alternatives considered
## Acceptance criteria
## Risks
```

提案可以包含计划、迁移步骤和待解决问题。验收标准描述可观察的完成状态；风险包括失败和放弃的能力。

#### `implemented/`

```markdown
## Problem
## Decision
…bespoke sections…
## Alternatives considered
## Consequences
```

用现在时态描述已交付的现实。后果涵盖代价与收益。禁止 `## Proposal`、`## Plan`、`## Migration plan` 和 `## Acceptance criteria`；`## Testing`、`## Deferred` 和 `## Related` 可以陈述当前事实。

#### `rejected/`

保留冻结的提案正文及原有章节，在 `Status:` 行记录结论。头部、`## Problem` 开头、`## Proposal` 和备选方案要求仍然适用。

### 曾考虑的替代方案——必需

在 `## Alternatives considered` 中记录真实备选方案及其落选原因，每个方案使用一个加粗引导的段落或一个 `### Why not <X>?` 子节。不得编造备选方案。日期早于 2026-07-05 且备选方案无法从记录中重建的记录，使用以下精确注释代替：

```markdown
<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
```

### 在生命周期之间移动

在同一变更中更新 `Status:` 并满足目标骨架。`proposed/` → `implemented/` 时，将提案和计划替换为已交付决策，将验收标准和风险折入后果或当前验证。`proposed/` → `rejected/` 时，添加否决原因并冻结提案正文。

### 中文对侧文件

`.zh.md` 对侧文件按 [i18n 约定](../../docs/i18n/README.zh.md)镜像英文结构。`# Agent Note: ` 和 `Status:` 标记保留英文。格式门禁跳过中文文件；配对门禁检查两侧一致性。
