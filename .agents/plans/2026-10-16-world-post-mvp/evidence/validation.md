# Post-MVP 文档验证

日期：2026-10-16。本次交付仅为原 P1–P5 的 MVP 之外设计、开发计划和详细验收清单。未实施这些能力，未运行产品功能测试、真实模型或外部适配器。

| 检查 | 实际结果 | 证据 |
|---|---|---|
| 范围 | 3 篇主文档、14 个工作包；P5 两包独立可选 | [开发计划](../development-plan.md) |
| Checklist | 98 项 ID 唯一，全部保持未勾选；原 MVP 两份 checklist hash 不变 | [检查结果](document-check.json) |
| 输入与资料 | 本次读取的原设计及 owner README hash 不变 | [baseline](baseline.json) |
| 本地引用 | 初步 21 个链接及相关 HTML anchor 通过；补充证据链接在保存后另验 | [检查结果](document-check.json) |
| Markdown | 主文档 AST 段落无硬换行，表格列数一致，文件末尾/空白通过 | [结构结果](markdown-structure.log) |
| 原有双语提案关联 | 两侧同义新增 Post-MVP 入口，pairing 更新并通过本组验证 | [配对记录](pairing.log)、[指定组检查](pairing-check.log) |
| doc-sync | 28 passed，1 failed，0 skipped；全仓 translation pairing 未通过 | [完整日志](doc-sync.log) |
| git diff --check | 退出 0 | [日志](diff-check.log) |

全仓失败仅报告本轮未修改的 `packages/simulation/simulation-local/README.md` 与中文对应文件内容不匹配其最后确认的 pairing hashes。没有替其他工作重录或覆盖这些文件，也不宣称全仓门禁通过；本次修改的提案配对独立验证通过。

doc-sync 在宿主执行，因为此前已确认沙箱禁止 tsx 本地 IPC；本次临时目录和证据均在项目内。没有降低检查规则。原 MVP 领域计划和剩余验收文档保持独立，没有被本清单替换，也没有移动任何 proposal 生命周期或提交/发布代码。
