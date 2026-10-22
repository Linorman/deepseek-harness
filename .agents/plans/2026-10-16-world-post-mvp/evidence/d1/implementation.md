# D1 验证记录

2026-10-20。`owner-tests.log`：真实 Loader JSON/SQLite 源路径离线后的空目标恢复、完整 bundle 发布/读回/坏目标拒绝/并发重试/离线转换均通过；2 文件 10 测试。`backup.spec.ts` 同时固定完整 byte bounds、manifest 篡改、脱敏/可执行配置拒绝、版本/转换器/inputHash 拒绝以及未知必需 Session 事件拒绝。

已验证 D01、D03、D04、D05、D08、D09：manifest 覆盖完整 owner cut、所有者版本及 hash、完整引用与附件；不可覆盖发布保留既有包；仅所有者权限保存私密明文，密钥和可执行 Host 配置不入包，原 cwd 仅作证据且执行前强制显式映射；完整恢复格式拒绝脱敏数据集；唯一支持转换对为 world-archive/1 → world-backup/1，固定 archive-envelope/1、精确输入/输出 hash、空损失集，原 owner 记录值不变。缺失引用证据不补造；更复杂业务格式迁移不被声称支持。

`product-import-tests.log`：完整真实 Loader JSON/SQLite 新目标导入双后端 2 测试通过；源目录下线，所有存储根位于项目 staging；校验重放、建立新 world/1 checkpoint 后，同 principal 原创建帧单次原子追加并登记 paused 发现目录，关闭所有者后原子发布。真实 child 在 Product 原件/目录落盘后、发布前 SIGKILL，目标目录不可见；新 staging 重试成功，成功重试重新验证。新进程式 Loader 重启发现原 run 和原 command，保持 paused/unowned，零模型调用；显式 restore 选新checkpoint成功，显式 start/pause 可用。旧创建不会重做。

D02、D06、D07 据此完成：源导出使用现有 sealed checkpoint protected collection，不复制 live 文件；完整原 Native/Team/Channel/Session/附件由实际 owner 重放恢复，坏 hash、丢 channel/Session、未物化保留及缺 execution provider 的拒绝证据分别见 `owner-tests.log` 与 `product-tests.log`。`product-typecheck.log` 已为空（owning tsc通过）；整体项目门禁交root集成后验证。Product 导出附原创建 provenance，不复制其他 administration 请求历史；Native业务责任保留。目标 owner parser 必须实际 replay，纯 hash 校验不替代 reducer/provider。

最终 Product 独立进程/Loader 验收：`product-import-tests.log` 4 cases（JSON/SQLite × 原 World/独立 branch）通过。分支包目标只有 branch，没有 parent Product 目录；原 branch receipt 可查询，`branchWorld` 同原命令无需 parent 再可用即返回原件。每 case 都覆盖发布前 SIGKILL、retry、重启发现、新 anchor 显式 restore 和 start/pause。分支保留原独立命令族，不伪造 world-create preflight。测试依赖最新 host lib（root统一build），此前artifact未导出preflight的启动失败日志已被最终通过结果替换。
