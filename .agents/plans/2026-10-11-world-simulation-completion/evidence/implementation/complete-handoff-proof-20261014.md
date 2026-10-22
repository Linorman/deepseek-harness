# R05：原完整剧本与非空职责交接

正式运行于2026-10-13，独立审计与最终检查于2026-10-14（Asia/Tokyo）。Native91/compiler9/Session0。R05完成并勾选，清单83/112，不新增items；原MVP完整目标和其余未验收项目保持。

## 实际修复

当前工作区已有C42非空交接实现，旧source通过记录不能证明当前实现通过。首次当前公司JSON/SQLite运行在HR新调岗提交处失败，三项人员准入测试同时拒绝合法新事项。原因是[通用请求准入](../../../../../packages/simulation/simulation-local/src/world.ts)把尚未持久化的虚拟候选intent作为`original`传入人员领域，违背[既有接口契约](../../../../../packages/simulation/simulation/src/world-native-types.ts)：只有实际保留的原件才能用于执行重验。

现在通用调用从当前Native intents中查找原件，新事项传undefined；预开事项仍传原持久intent，已接受收据仍走原精确重试。人员领域严格原件、当前权限、角色generation、岗位、read-set和制度检查保持；未为人员领域加特殊driver分支或放宽守卫。Native格式和模型输入形状未改变。原失败记录保存在 `.local/world-completion/r05-current/pilot-company.log`、`owners.log`和对应原数据库/Session。

此外同一文件的投票pin非空类型断言改为由已筛选的不可变数组成员类型说明保证。此变化只被TypeScript擦除，`erased-runtime-equivalence.json`核验“原捕获源码加实际准入修复”与最终源码的ESNext ESM输出逐字相同；15份simulation编译运行时JS也与正式lib执行时字节相同。没有将后续类型文字更改冒充先前捕获的完整源码。

## 完整链及非空交接

[正式流程](../../../../../examples/simulation-company/tests/complete-world.snapshot.ts)使用公司、实验室、协会三份原v1定义与同一Loader/Driver、实际Agent三工具和canonical私有Channel。公司/实验室按原顺序产生独立委员票据→制度生效→HR申请及该案独立批准→收费录用新人→新人自主请求供应商→独立代表真实回应→调岗→非空交接→离职。

调岗后的新人在t15通过自己的Agent/Session接受原HR工作，产生真实open commitment。完整只读义务清单含该原commitment；查询不修改Native或增加模型调用。t16原申请人使用已有`interaction/cancel`显式撤回旧工作，另建独立replacement request。继任者通过实际收到的原Channel消息和本人的Native业务上下文独立`interaction/accept`，原申请人收到其确认后执行显式fulfillment确认。旧assignee/debtor和createdBy永远保留，新承诺有不同身份、不同debtor、不同Session及实际接受operation；没有改写旧任务或把送达回执当接受。

人员owner在职责结算后于t18关闭原assignment，保留原Person/Persona/Participant/Session与费用台账。独立审计检查原创建<原接受<显式取消<新创建<独立接受<履约确认<离职提交的实际Native序号；同时核验代表回应先于调岗、调岗先于原非空责任。取消、接受、确认分别在其原operation/settled的真实前后prefix中核对，没有由当前snapshot反推伪造断点。此剧本使用原底层允许的取消/再建，不声称支持任意跨owner责任自动继承。

协会保留不同制度、已有志愿者录用及failure-only外部组合，资源始终为空；它不被重命名成公司剧本，也不替代公司/实验室的非空交接证据。

## 原件与恢复

JSON/SQLite×source/plainNode lib×三场景12案36独立生命周期PID；warm1908次keyless模型调用、9540真实assistant chunks、64物化Session与292真实canonical posts。公司/实验室每案189调用、63accepted决策、11世界事项，final revision1569/time18；协会每案99调用、33决策、6事项，revision808/time9。所有24次cold逐项保持原Native完整state/journal、Session及身份，paused/0model。lib直接核验包路径、execArgv=[]且无tsx/import/loader，不以测试driver的`.ts`文件名混淆包消费模式。

[独立原件审计](complete-handoff-audit-20261014.json)exit0：从实际JSON/SQLite WAL重建所有sender/recipient、trace/correlation、Envelope、receipt与Session消费；核对实际model messages、三工具调用/结果、Native context-view及票据原来源。私密director fact未进入新人、代表或其他角色的模型、Session和通知。费用只一次将10/0变为7/3，原hold与任职/ready/result/grant同提交；调岗和离职原子结束旧任职而不复制人物。

[plainNode编译Native纯读取](complete-handoff-native-replay-20261014.json)独立读取12原库，owner=unowned，snapshot/records与原件全等；[source逐entry fold](complete-handoff-prefix-replay-20261014.json)核验每个真实业务前后prefix，包含新增非空交接的原operation/settled。审计reader的PID不计入36生命周期PID；均不进行writable restore或模型调用。

11609份相关源码、JS、配置、fixture和类型输入（101,081,080字节）保存于 `.local/world-completion/r05-current/runtime-bytes`，`current-inputs.json`内容manifest hash为 `300181616df045c4810c78ae0237a2f6543aeed8f13721c51509d8256c6ca83b`。这是执行后、类型修正后捕获的当前范围；已核验生产JS未变和前后输入等价，不称为执行前冻结。所有源库、模型/Session、原日志、失败与审计程序都留在项目内。

## 检查及准确命令

正式source6和lib6通过，218–270s；修复后公司pilot两后端通过并各cold两次。人员/业务/权限八文件100项通过；另五文件85项覆盖原件准入、制度、投票和披露（有重叠，不相加为唯一test数量）。Host/Client类型、scoped lint、完整build197及最终doc-sync29/29通过；README与三份owner Note双语同步，无新Agent Note。

所有命令在项目根执行，Node统一设置 `TMPDIR="$PWD/.local/world-completion/tmp"`，Python设置 `PYTHONDONTWRITEBYTECODE=1`。

```sh
WORLD_COMPLETE_EVIDENCE_ROOT="$PWD/.local/world-completion/r05-current/source" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/complete-world.snapshot.ts
CLOCKY_EXAMPLE_MODE=lib WORLD_COMPLETE_EVIDENCE_ROOT="$PWD/.local/world-completion/r05-current/lib" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/complete-world.snapshot.ts
pnpm exec vitest run packages/simulation/simulation-local/tests/business-context.spec.ts packages/simulation/simulation-local/tests/context.spec.ts packages/simulation/simulation-local/tests/business.spec.ts packages/simulation/simulation-local/tests/personnel-admission.spec.ts packages/simulation/simulation-local/tests/world-personnel-domain.spec.ts packages/simulation/simulation-local/tests/world-hiring-role-permissions.spec.ts packages/simulation/simulation-local/tests/task-interaction.spec.ts packages/simulation/simulation-local/tests/world-request-policy.spec.ts
pnpm exec vitest run packages/simulation/simulation-local/tests/world-norms.spec.ts packages/simulation/simulation-local/tests/world-governance.spec.ts packages/simulation/simulation-local/tests/world-context-access.spec.ts packages/simulation/simulation-local/tests/world-request-policy.spec.ts packages/simulation/simulation-local/tests/personnel-admission.spec.ts
pnpm run build
pnpm exec tsc -b tsconfig.host.json tsconfig.client.json
node --import tsx scripts/run-oxlint.ts packages/simulation/simulation-local/src/world.ts examples/simulation-company/tests/complete-world-scenario.ts examples/simulation-company/tests/complete-world.snapshot.ts examples/simulation-company/tests/fixtures/complete-world/model.ts
pnpm run doc-sync
node .local/world-completion/r05-current/inspect-native.mjs .local/world-completion/r05-current/cases-so-far.json .local/world-completion/r05-current/native-replay.json .local/world-completion/r05-current/audit-native
WORLD_AUDIT_PREFIX=true node --import tsx/esm .local/world-completion/r05-current/inspect-native.mjs .local/world-completion/r05-current/cases-so-far.json .local/world-completion/r05-current/prefix-replay-complete.json .local/world-completion/r05-current/audit-prefix
python3 .local/world-completion/r05-current/audit.py .local/world-completion/r05-current
```

原pilot filter漏匹配为6skipped，不计通过，后来先用vitest list核对真实名称。首次人员提交失败和lint的非空断言均保留。额外实际浏览器回归 `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-context-privacy.snapshot.ts` 在加载activation-supervisor具名导出时4案失败、尚未进入业务；直接plainNode进口能取得同名真实导出；全部构建结束后同一JSON公司case无需改动通过。首轮与doc-sync的Host构建同时执行，存在编译产物写入竞争，随后按依赖顺序完整四格全部通过，原末submitted决策现均accepted，读取新增0且console warnings/pageErrors为空，[最终浏览器复查](complete-handoff-browser-recheck-20261014.json)保存准确原件。这仍仅为原正文读取回归，不替代v1完整GUI矩阵。此失败不修改本条真实Loader完整剧本结果，也不被宣称为GUI成功。真实provider、收费SIGKILL全部边界、SDK发行和完整GUI/性能仍由对应未勾项验收，未宣布MVP完成。
