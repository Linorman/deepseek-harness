# R10 三领域小规模实测

2026-10-15 在 Apple M4 Pro、12逻辑CPU、24GiB内存、macOS27 arm64、Node25.9.0 上运行当前 plain Node lib。所有输入、硬件、原库、Session、journal、每0.5秒采样的RSS/持久字节、三个进程的命令/退出/耗时均保存在项目内 [测量目录](../../../../../.local/world-completion/r10-measurement)。[完整原始结果](../../../../../.local/world-completion/r10-measurement/results.json)包括逐100条journal累计序列化字节数；它与实际落盘字节分别记录。

## 范围与结果

公司和实验室通过治理制度、招聘、外部代表、一次调岗和一次离职产生真实历史；协会通过两次独立请求对同一个稳定外部身份裁决，保留原unknown库存。每格一个warm和两个新进程cold，六格共18独立PID、12次cold0model；完整state、Session和journal在两次冷恢复后均与原件相等。模型为脚本化，实际走Agent/三工具/Team链。

| 场景 | 后端 | Entity | journal记录 | warm整进程秒 | cold整进程秒（两次） | 最终持久MiB |
|---|---|---:|---:|---:|---|---:|
| company | json | 14 | 1617 | 48.78 | 1.52 / 1.53 | 4.34 |
| laboratory | json | 14 | 1617 | 43.19 | 1.53 / 1.53 | 4.34 |
| association | json | 10 | 822 | 29.48 | 1.53 / 1.02 | 2.31 |
| company | sqlite | 14 | 1617 | 36.11 | 1.53 / 1.53 | 3.96 |
| laboratory | sqlite | 14 | 1617 | 34.05 | 1.52 / 1.53 | 3.97 |
| association | sqlite | 10 | 822 | 10.17 | 1.02 / 1.02 | 2.16 |

这里只证明10–14个Entity、33–63个accepted决策、822–1617条journal的小型作者工作负载。人员churn仅一次调岗和一次离职，不代表长期频繁流动；外部重复联系仅协会同一身份两次请求，不代表高并发。每格只有一个样本，不计算p95或宣称SQLite比JSON快。RSS是采样观测，不是精确峰值。cold数字包含启动、恢复、断言、序列化证据和退出，最多受一个0.5秒采样周期及采样开销影响，不能当作纯restore API延迟。机器不是隔离基准主机；最终build/测试在测量结束后才启动。

## 可复核输入与命令

[Root独立审计](../../../../../.local/world-completion/r10-measurement/root-audit.json)逐一核对PID、零模型、完整原件相等、原提案票数、人员变动及同身份外部请求。输入在执行前冻结，JSON三格复用时比较两版manifest，只有测量脚本本身变化，生产输入不变；最终归档含实际源码和lib，完整hash见该审计。

```sh
TMPDIR="$PWD/.local/world-completion/tmp" PYTHONDONTWRITEBYTECODE=1 python3 -B .local/world-completion/r10-measurement/measure.py
```

原命令、标准输出/错误及120秒硬进程时限在每格 `measurement-0/1/2.json` 中。首次后处理错误把公司两个提案的四张票假定为两张；第二次把director-mediated adjudication误计入规则interaction表。两次原脚本、错误日志和原库均保留。修正为逐proposal冻结electorate两票、协会两份同identity adjudication后，复用已完成且生产输入一致的JSON三格，再执行SQLite三格。没有更改生产配置、阈值或负载来通过验收。
