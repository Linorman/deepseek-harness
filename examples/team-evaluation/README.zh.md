# Team 测试案例

[English](README.md) | 中文

六个本地案例按简单、中等、困难分级，覆盖 Team 协作以及社会或公司模拟。每个案例都有独立的 prompt、输入和验收清单。从仓库根目录运行，需要本地 Node 和 pnpm；案例均不需要网络搜索。简单和中等公司题使用脚本模型运行 Simulation；困难题让 Team 自己形成组织并决定走向。

| 难度 | Team 协作 | 模拟运行 |
|---|---|---|
| 简单 | `simple/01-ticket-triage/` | `simple/02-buyer-supplier/` |
| 中等 | `medium/03-order-reconciliation/` | `medium/04-procurement-exceptions/` |
| 困难 | `difficult/05-company-emergence/` | `difficult/06-community-response/` |

简单、中等任务题：配置好 Headless 模型后运行 `run.sh`，或把 `PROMPT.txt` 提交给 Web Team；使用有提供的 `verify.mjs` 检查文件，并按 `CHECKS.txt` 核实派工。简单、中等公司题：先运行 `run.sh`，再提交 `PROMPT.txt` 分析实际 Simulation 记录。困难题：直接把简短的 `PROMPT.txt` 交给 Team，或配置模型后运行 `run.sh`；Team 自定角色、分工和决策，`CHECKS.txt` 只核对证据与约束，不预设结局。社会模拟题要求创建独立 Simulation run，入口说明在该目录的 `RUNTIME.txt`。

Headless Team 题使用默认共享工作区，需要已配置可用模型。简单、中等公司脚本使用本地脚本行为，无需 API Key。每个案例的 `output/` 已被 Git 忽略。`CHECKS.txt` 只供测试者验收，不要发给被测试的 Team。
