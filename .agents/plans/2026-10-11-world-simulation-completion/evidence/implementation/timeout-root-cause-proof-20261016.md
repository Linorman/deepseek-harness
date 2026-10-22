# 历史间歇超时：因果实验、修复与验收边界

2026-10-16；所有原件在项目内 `.local/world-completion/timeout-investigation-20261016/`。本轮没有真实模型请求，没有新增 checklist 条目，也没有修改 timeout、retry、覆盖率、业务限额或耐久性规则。

## 已证明的问题

1. **异步命令终态被错误的短轮询判定。** `world-replanning` 创建请求先返回accepted，后台才准备并发布completed；fixture使用`vi.waitFor`的默认1秒窗口。在实际宽范围运行中，4个replanning用例及1个丢失终态发布用例因此发生断言失败。将真实终态发布延迟1.2秒后，旧JSON/SQLite两案稳定失败；基于准确终态事件的版本两案通过，整个用例的原5秒期限没有改变。`terminal-delay/before.log`与`fixed.log`保留红/绿原件；`before-fix/`保留旧源码，诊断配置和注入代码可复现。拆开的IO阶段诊断不是验收替代。
2. **测试文件并发未按持久IO/主机资源约束。** 本机12逻辑CPU；安装的Vitest `resolveMaxWorkers()`默认使用`availableParallelism()-1`，即11个文件worker。完整217文件自然运行有31个5秒超时和上述5个断言失败，涉及多个原本独立的真实日志夹具。失败期间多个worker的事件循环停顿与fsync回调延迟同时达到约0.9–1.37秒。异步fsync耗时包含调度等待，不能把这些数值直接当作磁盘介质延迟。`broad-trace/`保留逐用例时间线、IO采样及完整失败结果。

一个原路由拒绝用例本身包含243次fsync：fixture102、start4、createTask37、advance68、cleanup32。基线拒绝检查约1–3ms；仅对fsync增加25ms延迟，就能令未改动的原用例在5秒处超时。分阶段诊断仍完成相同真实操作和拒绝断言，总计约7.37秒，证明串行持久化与调度延迟的累积足以触发超时，而非必然存在未完成的业务等待。该注入实验只证明机制，不冒称测得了10月15日的真实IO延迟。

## 修复

- `world-replanning.spec.ts`在准确命令的持久终态append及store fold后继续，并继续断言completed；fixture在后续可能失败的初始化前注册幂等清理。
- `requests.spec.ts`等待准确的被注入发布尝试，再执行原关闭/冷恢复断言；不再通过1秒轮询猜测回调是否发生。
- `vitest.config.ts`默认最多4个文件worker；CI/coverage显式worker配置仍覆盖它。文件集合、测试内部并发、5秒默认期限、已有显式期限、重试和断言均保持。此配置限制运行器需求，不跳过fsync、不换内存后端、不删测试。

检查过聚合门禁调度和分区覆盖率的既有决策，它们仍分别拥有外层并发和coverage分区，没有被新测试调度说明替代。

## 实际验证

| 范围 | 原件与结果 |
| --- | --- |
| 初始7个相关用例带IO采样 | trace-baseline.log；7通过，53因明确name filter未执行；属于诊断而非整组通过 |
| 原8文件整组带采样、单worker | full-trace/results.json；380通过，保存运行中IO与事件循环采样 |
| 人为25ms fsync延迟 | slow-sync/run.log；原用例预期失败，未改变业务或超时阈值 |
| 1.2秒终态发布延迟 | terminal-delay/before.log旧两案失败；fixed.log新两案通过 |
| 两个修复owner文件 | owners-fixed.log；17通过 |
| 原默认并发的完整Simulation组 | broad-trace/results.json；217文件，3633通过/36失败/1原有跳过，36=31超时+5断言失败 |
| 4 worker最终完整组 | bounded-trace/results.json；217文件，3669通过/0失败/1原有跳过，703.58秒，退出0。same-inventory-proof.json证明两轮3670项集合完全相同、原36项失败均转为通过 |
| 类型、lint、文档 | types-final.log为0 diagnostics；lint-final.log退出0；doc-sync-final.log为29/29通过 |

诊断最初把TMPDIR设得过长，使tsx的Unix socket返回EINVAL；改为仍在项目内的`.tmp/timeout-investigation`后，原配对和doc-sync命令通过。该启动错误单独保留，不计为产品失败。尝试单文件排除参数未覆盖项目级include，因此最终4-worker命令实际仍执行恢复矩阵，不以拟议排除范围冒称实际运行范围。

每2秒写入的诊断快照可能在故障测试的SIGKILL处被打断；分析器明确列出不完整采样文件，保留原件，不用它们判断业务日志完整性或省略测试失败。完整测试结果由Vitest结果和退出码拥有，采样只是耗时诊断。

## 不能推断的结论与 R13

10月15日原失败没有逐操作时间线，不能断言每个旧超时都由相同的硬件原因触发。本次证明并修复了当前可以重现的短轮询缺陷，并验证了限制并发对当前环境的效果；不把“重跑一次通过”当根因。卷当时剩余约8.3GB/1000GB、主机存在大量内存压缩，但没有单独隔离验证两者，不能将其宣布为唯一原因，也未擅自清理旧证据。

当前集成输入与R11归档及后续复查源码相比有84项变化，其中包含约20个ui-simulation源码文件的实质改动；多数其余条目是构建或文档产物。`integration-drift.json`逐项列出。旧浏览器/交互验收不能未经核对就覆盖当前UI。未覆盖该差额前，R13继续未勾选，proposal保持proposed；原清单仍为111/112。已向用户询问这些UI改动是否仍在其他任务进行及新验收证据位置，不覆盖既有改动。
