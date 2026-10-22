# C17 原供应商合同保持

外部展开前，实际 buyer 和已有授权 member custodian 的独立 Agent 分别通过 simulation_observe/stage/submit 提交 interaction/request、interaction/accept。Native 创建唯一非空 open commitment，原 terms 将原外部组织拥有的 supplier-stock 数量 2 转给买方原 buyer-stock；原 custodian 是资源 controller 与 debtor，buyer 是 creditor。原组织 cognition:none 不被改成 agent，不伪造组织 writer。这是原供应商资源上的真实未执行合同，展开不为新代表改写合同主体、复制承诺或转移账户。

company／laboratory × JSON／SQLite 在 source 和当前 full build 的 plain Node lib 各 4 组通过。24 个独立进程；8 create 各 54 模型调用，16 cold 均 0，恢复保持 paused。实际首代表展开、两买方并发 stale→supersedes reuse、3 联系及 9 canonical 收发均保留。原资源、commitment、interaction、2 已应用操作、2 原决策与组织原件完全保持；双方原 Session prefix 保持，checkpoint 后完整 Session 在两次 cold 逐事件相等。新代表是独立 Person/Participant/Session，唯一 represents 指向原组织，既不是旧合同 debtor/creditor，也没有新账户。

[准确命令／原件／范围](../../../../../.local/world-completion/c17-external-contract/fixture-report.md)、[source4](c17-external-contract-source.log)、[lib4](c17-external-contract-lib.log)、[89 artifact hash](c17-external-contract-fixture-manifest.json)、[fixture 检查](c17-external-contract-fixture-verification.json)、[root 独立逐件检查](c17-root-core-verification.json)。root 另执行项目内 c17-root-core-verification.py 和 verify-fixture-evidence.py，核验真实 terms、controller/owner、原决策/操作、Person/Session、process args/退出及 cold 调用数。

X06 完成；不承诺非认知组织直接作为 cognitive debtor，Native contract owner 仍是原合法资源 custodian。X10 的完整实际额度矩阵、X12 取消/未知 IO/SIGKILL、v1 作者和 SDK/UI 完整验收继续待办。未提高额度、未新增 checklist items。C16 原 fixture 与 73 原 hash 完全保持；C17 首次 director accept 被普通 director 决策限制拒绝的日志保留，最终流程使用合法已有 member/controller，不绕过权限。

[当前生产 input hash](c17-current-production-hashes.json)、[当前完整 build](c17-current-build.log)、[Host TypeScript](c17-current-types.log)通过；C18 的 Native/adapter 修复有 [owner29](c18-owner-tests.log)、[邻域67](c18-focused-regression.log)、[hire/HMR40](c18-hire-regression.log)、[既有actor lib4](c18-lib-existing-actor.log)及 [准确命令](c18-root-commands.json)支持，但其真实超限矩阵尚未完成，X10 不勾选。

最终 [doc-sync29](c17-current-doc-sync.log)全部通过，git diff --check 无空白错误。此前因尚未完成的 C17 类型片段及 C18 草稿造成的构建/类型失败保留在 .local/world-completion/tmp/c18-build-first.log、c18-build-current.log、c18-doc-sync-current.log；草稿移出构建路径、C17 类型修正后，当前完整 build/Host types/doc29 全部通过，不将先前失败视为通过。
