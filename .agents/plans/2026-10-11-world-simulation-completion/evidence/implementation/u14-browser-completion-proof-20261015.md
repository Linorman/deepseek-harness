# U14 三场景产品流程验收

2026-10-15 使用实际认证 Web、Loader built Host/Client、真实 Agent/Native/Team/Session 完成公司、实验室、协会 × JSON/SQLite 六案。模型为 scripted，验证产品流程与协议，不代表真实模型质量。

## 流程和证据

浏览器从新建世界、选择作者模板、检查定义、创建暂停运行、开始调度，到查看制度原票、任职和外部交互，创建完整检查点，关闭并重新启动 Host，最后从浏览器显式恢复原运行。所有业务结果来自真实 Agent 链；没有注入成功对象或由浏览器伪造角色决策。公司/实验室覆盖制度生效、新人、独立供应商代表、实际调岗、非空交接和离职；协会按其原定义覆盖独立委员会批准、既有人物录用和两次外部询问，不宣称协会定义含调岗或制度制定。

[独立审计及168份原件hash](../../../../../.local/world-completion/u14-root-review/audit.json)核验每票的实际 accepted Decision、operation、独立 Session、consumption contextHash 和冻结正文 hash。全部 checkpoint/restored 的 world、entities、relations、resources、decisions、operations、commitments 相等；六案共954次脚本模型调用，冷读取/恢复0次模型、冷读取0次 writable open。每案只有一个 create、checkpoint、restore 命令。当前2,171个输入在复跑前冻结，复跑后hash未变化。

| 场景 | 后端 | 模型调用 | 原件 |
|---|---|---:|---|
| company | json | 189 | [proof](../../../../../.local/world-completion/u14-product/browser/json-company-RLBghh/proof.json) |
| company | sqlite | 189 | [proof](../../../../../.local/world-completion/u14-product/browser/sqlite-company-atu3kF/proof.json) |
| laboratory | json | 189 | [proof](../../../../../.local/world-completion/u14-product/browser/json-laboratory-d7NUPD/proof.json) |
| laboratory | sqlite | 189 | [proof](../../../../../.local/world-completion/u14-product/browser/sqlite-laboratory-HOh9GF/proof.json) |
| association | json | 99 | [proof](../../../../../.local/world-completion/u14-product/browser/json-association-Y5zk5l/proof.json) |
| association | sqlite | 99 | [proof](../../../../../.local/world-completion/u14-product/browser/sqlite-association-u6kSsA/proof.json) |

## 实现与验证

[治理安全边界](../../../../notes/implemented/bug-fix/2026-10-15-native-governance-boundaries.zh.md)补齐最后一票已接受但尚无 director 计划时的生产结案；Native 在写队列内重验冻结票据及提前结案条件，不改原 deadline。新 vote artifact 固定为 native/3 generation2，旧 artifact 不自动替换。[控制状态轮询](../../../../notes/implemented/bug-fix/2026-10-15-simulation-control-polling.zh.md)对同 run/凭据世代的在途请求共享 promise，避免慢速历史读取被下一轮取消；切换和撤权仍使旧请求失效。

使用仓库已有 Playwright（当前无 Browser 插件），1440×1000、zh-CN。六案均验证实际页面、非空业务内容、投票/任职/外部检查器与恢复控件；`pageerror` 和 console error 均为空，每案保留四张截图。窄屏/键盘/主题/减少动效由已完成 U15 单独覆盖。

准确命令（`SCENE` 分别为 company、association、laboratory）：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" XDG_CACHE_HOME="$PWD/.local/world-completion/pnpm-cache" npm_config_state_dir="$PWD/.local/world-completion/pnpm-state" WORLD_SCENARIO="$SCENE" pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-complete-product.snapshot.ts --maxWorkers=1
python3 -B .local/world-completion/u14-root-review/audit.py
```

[公司日志](../../../../../.local/world-completion/u14-root-review/company-web.log)、[协会日志](../../../../../.local/world-completion/u14-root-review/association-web.log)、[实验室日志](../../../../../.local/world-completion/u14-root-review/laboratory-web.log)各2项通过。首次错误选用 `vitest.snapshot.config.ts` 导致“未发现测试”的两份日志保留在同目录；不计作通过。此前产品流程中的真实失败与修复仍保留于 [u14-product](../../../../../.local/world-completion/u14-product)，没有删除失败或增加额度制造成功。

恢复浏览器测试在同一测试进程内重启独立 Host；新操作系统进程恢复另由当前完整 source/lib三场景12格36PID证据及R06覆盖，不能把浏览器重启称为新PID。真实provider已按用户要求暂缓，B04/R08/R09不勾选。未发布PR；最终组合diff的分发和门禁归R11。
