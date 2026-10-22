# R11 最终组合验证

2026-10-15 完成本轮未暂缓工作的最终验证。按 `dsh-pre-push-checks` 依据实际改变选择验证；保留失败和未执行范围，不把多个重叠范围相加为全库测试总数。

## 本轮修复

完整lint发现Fixture Host的封闭RPC switch遗漏 `simulation.world.domain.read` 与三种 `simulation.world.management.*`。现统一返回原 `simulation-product-unavailable`，不再落入未处理分支；对应实际Client调用的回归测试覆盖四条路径。`creation-types.ts` 修正两处纯类型格式。测试目录中四个旧 `world-driver-model` 编译副本完整移到项目内 [stray-outputs](../../../../../.local/world-completion/r11-final/stray-outputs)，原TypeScript源码保留，未删除既有工作。

## 实际结果

| 检查 | 结果及原件 |
|---|---|
| 完整build | 退出0，197个Client artifacts；[日志](../../../../../.local/world-completion/r11-final/build.log) |
| Host/Client类型 | `pnpm exec tsc -b tsconfig.host.json tsconfig.client.json` 退出0 |
| 完整lint | `pnpm run lint:contracts-ready` 退出0；[日志](../../../../../.local/world-completion/r11-final/lint.log) |
| 新fixture拒绝路径 | 1file/33通过；[日志](../../../../../.local/world-completion/r11-final/fixture-regression.log) |
| 当前治理/执行/退休/运行时 | 6files/105通过；[准确文件和命令](../../../../../.local/world-completion/r11-final/commands.json) |
| 源码SDK | 3files/12通过，真实stdio Host创建/查询/控制/新进程恢复 |
| compiled TS与installed wheel | 3files/12通过；[分发日志](../../../../../.local/world-completion/r11-final/sdk-distribution.log) |
| 分发原件审计 | 24格、56唯一Host PID、4460对解码RPC，原业务仅提交一次，cold0model；14个wheel Python模块与source/installed逐字节相等；[审计](../../../../../.local/world-completion/r11-final/sdk-audit.json) |
| 当前浏览器 | [U14](u14-browser-completion-proof-20261015.md)三场景×双后端6/6，真实创建/调度/业务/恢复；未用mock成功对象 |
| 故障恢复 | [R06](r06-fault-matrix-proof-20261015.md)128SIGKILL/256cold；当前执行lib不变 |
| 文档 | [doc-sync最终29/29](../../../../../.local/world-completion/r11-final/doc-sync-final.log)，退出0 |
| whitespace | `git diff --check` 退出0 |

[最终结果](../../../../../.local/world-completion/r11-final/completion.json)与过程命令保留不同阶段的真实退出码。U15的1235个UI/runtime输入仍与原验证完全相等；复用已有5490项GUI证据及原窄屏/键盘/主题/减少动效实测，不重复声明为本轮新跑。[漂移核查](../../../../../.local/world-completion/r11-final/prior-evidence-drift.json)中R06仅两项差异：原生成声明完整移位、creation-types纯格式改变；实际执行lib均不变。新增fixture路径由33项回归和完整lint覆盖。

## 失败与限制

首次lint因四个遗漏RPC、纯类型格式、散落生成声明失败；修复后重建、重验类型及lint。首次doc-sync为28/29：proposal整理时更改了规定的 `## Risks` 标题，恢复后重做配对并复跑完整29项通过。SDK审计首次因绝对/相对路径比较错误把分发汇总误当业务proof而失败，规范化路径后全部原数据库/receipt/身份断言通过。所有日志保留，未降低测试阈值或增加执行预算。

最终输入归档是在验证后捕获，不冒称执行前冻结，也不涵盖仓库全部传递依赖；确切文件与hash见 [输入报告](../../../../../.local/world-completion/r11-final/input-report.json)。新wheel SHA256为 `4db98621f353891f51b982b60f0427e9eefaca4dcc4dfc7b030e22d05e88dd52`，与已完成U13的954项Python验证wheel相同。未重跑完整平台矩阵、全库覆盖率或所有旧历史fixture。真实provider、费用硬预算和模型质量由用户明确暂缓；B04/R08/R09不计通过，R13及proposal生命周期保持待验收。没有创建/发布PR。
