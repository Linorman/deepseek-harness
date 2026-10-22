# C11 人员取消竞争进展

日期：2026-10-12；Native69；checkpoint manifest3、Session format0、通用SQLite schema不变。整体目标仍在进行，未commit/push/PR。

既有 O16 已完成并勾选，checklist 36/112，未新增 items。当前输入 hash 见 [Root输入清单](c11-personnel-input-manifest.json)。

## 已验证

PersonnelWorldExecution 已补两处真实竞争：取消在reserve前赢时使用原cancelledresult，不误报recovery-required；原quiescent heldcut进入后取消先赢时，late runtimeproof失效，原取消结果／待结算责任决定后续行为，不能发布mutation或重复预留。只有原已确认maintenance可以完成，取消历史变化阻止自动resume。

实际Loader／Agent／三工具／Team／Channel source13和plainNode lib13分别13/13：三基础分支（before-reserve、during-maintenance、commit-wins）×JSON/SQLite×company/laboratory共12，另JSON/company真实heldcut-before-Native取消先赢1。26个独立cold process均paused、零模型调用，原身份／Persona／Sessionprefix／assignment／原request-plan保持。during-maintenance原draining保留cancel-requested／fence／目标预留，待真实停稳后精确结算；commit先赢只保留原唯一mutation/result，后续取消already-committed。

[准确命令、4源码文件hash、52raw originals hash与历史阶段](c11-personnel-cancellation-agent-manifest.json)；[source13](c11-personnel-cancellation-source-final13.log)、[lib13](c11-personnel-cancellation-lib-final13.log)。52raw与4文件均逐项重新核验，无hash mismatch。原resident2、microsteps32、maxBytes4096及全部原catalog预算不提高。

`pnpm run build` exit0、197client artifacts：[log](c11-build.log)。`pnpm run doc-sync` 29/29：[log](c11-doc-sync.log)。personnel handler typedlint通过；维护／dispatcher／Native准入52测试通过：[log](c11-maintenance-regression.log)。`git diff --check`通过。所有临时、cache、编译、raw与日志均在项目内；旧pilots保持。

## 仍在验证

完整O16的未知IO精确清理需要actual raw.dispose pending期间保留原writer/容量／原cancelcommand，晚实际停止后同原件结算，不能只以beginMaintenance的draining返回hold代替。该 actual unknown-stop 补证现已在 JSON/SQLite 两后端通过：真实 raw.dispose入口hold时，Nativewriter revoked/charged、原Teamepoch未quiescent；原fixedcommand保存cancel-requested和原fence/reservation，unsafe settle拒绝且snapshot不变。释放后await实际原dispose和原maintenance quiescent，同command才cancelled，原assignment/binding/profile/phase保持、exactretry0append。不能以beginMaintenance返回hold替代这个真实IO证据。

该补证首先揭示新控制缺口：connection.cancelWorldCase被maintenance中的checkpoint admission屏障挡住。Root只为同一actualactive maintenance拥有的原personnel case开放该控制请求；关闭connection、普通checkpoint、无关case以及Nativesealedcut继续拒绝，未放开model／activation／publication。失败双backend日志保留，窄修后 [actualunit2](../../../.local/world-completion/tmp/personnel-retirement-tests-final.log) 通过。最终5文件56相关回归通过：[log](c11-personnel-final-tests.log)。

O14最小真实json单测已证明actualController.lifecycle.revoke后raw.dispose入口尚未结束时Nativewriter revoked/仍charged、Teamepoch无quiescence且不能启动第二writer；释放后await实际dispose／同maintenance停稳才released。此单例不代替双backend、超时、卸载、迟到旧epoch callback，完整O14仍未勾选。新增unit本批仅验证双backend的未知rawIO取消清理，尚不含timeout/unload/旧epochcallback；O14继续未勾。

O15重新入职／计数、O17完整SIGKILL矩阵、v1／SDK／UI／外部领域均继续待办；不增加checklistitems或删难项。

最终新build：[log](c11-build-final.log)，exit0/197 artifacts；完整lint：[log](c11-lint-final.log)；最终doc-sync：[log](c11-doc-sync-final.log)，29/29。Root补正窄准入后还以新编译产物复跑13组，保留初版52raw原路径并把新lib26raw保存到独立current13目录；该轮状态与artifact hashes以后附final-checks为准，不覆盖原样本。

最终actualunknownIO单位 manifest：[记录](../../../.local/world-completion/tmp/personnel-retirement-manifest.json)，actualdepart reservation的targetPositionId原值null，不冒称其拥有transfer目标容量。目标容量由上述actualtransfer13矩阵证明；这两者范围分开。Root最终编译产物13/13通过，初版52raw原路径已经恢复且hash全匹配；新编译产物26raw与hash见 [当前lib样本](c11-current-lib-artifacts.json)。精确收尾状态见 [最终检查](c11-final-checks.json)。
