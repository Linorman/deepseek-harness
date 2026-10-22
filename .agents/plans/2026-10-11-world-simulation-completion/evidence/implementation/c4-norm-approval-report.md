# C4 自动截止、制度与单次招聘批准

输入见 [c4-input-manifest.json](c4-input-manifest.json)，SHA-256 为
`5f18ff5e2a907f28a3fead850a8bdd83c3319fa14d128443945cf9b793fd6b51`。
治理 agent 文件与命令见 [其 manifest](c4-hire-approval-agent-manifest.json)。
Native stream 65 拒绝 64 及更早 stream；checkpoint manifest 3 和 Session 格式 0 保留。
全部中间文件、测试数据和构建输出均在项目中。

## 已完成行为

提案 acceptance 同批次固定原 deadline、原正文 hash 和实际 source operation。
Native 在 deadline 阶段计算真实票据的唯一 resolution 与 wake；早结案在同批次取消原 deadline。
普通 cancel/wake API 不能取消未结提案的截止或伪造其事件。
实际场景冻结两名委员，只接受一票后结束另一成员关系，仍按原 electorate 在截止时失败结案；迟到投票被拒。

Norm 版本保留严格 source、recordedAt、scope/audience、effective/available 时间、原 approved body/hash 和 proposal/resolution。
enact/revoke 走同一请求、Channel、计划和 Native mutation 路径；closure 追加结束旧区间，旧原件不被改写。
mutation 的 recordedAt 由 Native 首次保存，回放不读墙钟。
Norm、结果、原 announcement 与精确 recipient wakes 在同批次保存，另保留实际生效/截止纯时钟边界。
公告正文只来自批准文档，不复制 director rationale；公告、Session 消费和理解分开。
原 Norm plan 重试在创建与冷恢复后均返回唯一原结果，不追加、不再公告。

advisory 只作为获准背景，validated 只安装 `clocky.organization.hiring-approval/1`。
未知 policy/参数、代码和金额字段严格拒绝。
制度要求实际委员会、岗位 allowlist 和有限单次聘用批准；制定制度的 resolution 不能成为该次招聘的批准。
原招聘 request/hash、Norm 版本、岗位和有限 Persona 集合进入审批提案，委员分别从真实 Session 决策投票。
reserve 保存每份必需原 resolution，commit 核对同一依据和全部当前生效 validated Norm。
无批准的真实 reserve 不追加；driver 保留原计划并继续其他角色，批准完成后实际入职及新人 first-action。
制度/依据变化拒绝并保留责任，不重写旧计划或释放未知占用。

新制度不改写已接受 task/commitment。
不支持的 migrate-existing 返回实际类型化义务引用，拒绝发布 Norm/closure/公告；没有伪装成成功结果。
普通非 World 决策也通过 Native context-view 保存可见 fact/Norm 背景，不使用隐藏模型回调。

## 命令与证据

命令设置 `TMPDIR="$PWD/.local/world-completion/tmp"`；Python 设置项目内 pycache 和 pytest cache。

- `pnpm exec vitest run` 的 Native/run/checkpoint/scheduler/cohort/dispatcher/domain/治理/审批/Norm 十文件选择：
  [199 passed](c4-integrated-tests.log)。包括当前制度改变、旧批准、不同 case/hash/Persona、无批准、未知 policy、受控迁移拒绝及原历史关系。
- Norm parser/纯 fold：[26 passed](c4-norm-tests.log)；新增两个 common expectedTime 与正文日期冲突拒绝：
  [当前文件 10 passed](c4-norm-time-tests-fixed.log)。
- `pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-norm.snapshot.ts`：
  [source 4 passed](c4-norm-source-final.log)，实际独立投票→制度→HR 请求→独立单次招聘批准→入职/新人 Session，并独立新进程恢复 0 调用。
- 自动截止：[source 4 passed](c4-deadline-source-final.log)；原治理完整回归：[source 4 passed](c4-governance-source.log)。
- `CLOCKY_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-norm.snapshot.ts examples/simulation-company/tests/world-governance-deadline.snapshot.ts examples/simulation-company/tests/world-governance.snapshot.ts`：
  [12 passed](c4-world-lib.log)，使用 plain Node，构建前置条件已执行。
- `pnpm run build`：[197 client artifact](c4-build-final.log)，Host/Client/Web 通过。
- 真实渲染的中英文新等待原因与 TS SDK 控制解析：[162 passed](c4-stop-status-tests.log)。
- Python 控制 DTO：[101 passed](c4-python-control.log)。新增控制原因同步 TS product/client-server-protocol 和 Python 两个控制面；不据此宣称领域 DTO 已完整同步。
- root lint 初次仅一个超长行，[最终修复](c4-lint-final.log)；新 agent 文件 lint 与 Host 类型证据见其 manifest。
- `pnpm run doc-sync`：[29 passed](c4-doc-sync.log)。原两个缺 return annotation 的 JSDoc 失败保留，[修复后通过](c4-exports-fixed.log)。

## 仍需完成

本次勾选 F01/F05/F06、G06/G08/G09/G10，清单 22/112，未增加 items。
F02/F03 的 Norm 历史、公告/未公告和私密边界已有纯测试；仍安排更完整真实模型更新/撤销链，因此暂不勾选。
G11 的 revoke 纯合同与 reducer 已实现，完整真实模型撤销尚待验证。
G12 的 SIGKILL/append/barrier 故障矩阵未执行；普通冷恢复不能代替它。
金额/资源 owner、外部主体、调岗/离职、v1 作者输入和完整领域 DTO/SDK/API/UI 继续待办。
UI 本次仅使用既有 RunStatus/locale owner 补两个等待提示；[静态 audit](c4-premium-audit.json)仍有四处既有作者表单问题，完整 UI 合规不作已完成声明。
原招聘/自主请求/预约当前 [source 20 passed](c4-hiring-booking-source.log)，原招聘/预约/事实当前 [lib 18 passed](c4-existing-lib.log)。
最后输入的 Norm 时间拒绝和 dispatcher [15 passed](c4-final-input-tests.log)；Git diff whitespace 检查 [通过](c4-diff-check.log)。
assembled Web [日志](c4-web.log)仍运行，exec session 18451 经实际句柄确认 live；运行中不当成通过。
