# Agent Note: 保留引用的世界归档

Status: implemented

[English](2026-10-19-world-reference-archive.md) | 中文

## Problem

Checkpoint 引用只能标识所有者前缀，不能携带离线恢复所需字节。仅移动 Native 日志，会让 Session 输入、Channel 证据和图像继续依赖原主机。

## Decision

[封闭集合导出](../../../../packages/simulation/simulation-team/src/archive.ts)通过实际所有者能力复制完整 Native、Team、Channel、Session 前缀和被引用图像。未物化 Session 仍是引用，不伪造日志。完整前缀保守保留全部较早引用和容量计数，不提供源删除或压缩。跨 Team 祖先和不支持的闭包外 Session 父级被拒绝，不能产生不完整归档。

不可变归档正文和附件字节具有 SHA-256 校验。验证还将完整 Session header 和图像引用元数据与保留引用比对：仅身份相同不足以证明归档内容满足原读取者的要求。位置发布在复制、读回校验和 fsync 后执行。位置记录携带原引用 pins；未完成或缺失位置不能作为可读归档。恢复在隔离 staging 中由原已安装所有者 parser 校验不透明记录，要求显式 cwd 迁移，保留原包，只在所有者关闭后发布。目标为迁移后的 header 发布合法新 checkpoint，保留原 checkpoint manifest 和日志前缀。Receipt 记录源 hash、header 路径映射和新 checkpoint 身份。旧 checkpoint 正确拒绝映射后的 Session fingerprint，新锚点支持常规恢复和显式 resume。成功重试重新验证现有所有者数据；失败且未发布的 staging 在所有者关闭后可清理。

[私密完整 bundle](../../../../packages/simulation/simulation-team/src/backup.ts) 添加严格绑定内容的 manifest，不重写所有者证据。包 hash 覆盖所有元数据和字节；每个所有者的 hash、版本和 cut 支持准备目标前的检查。唯一离线转换使用固定 `archive-envelope/1` 转换器和精确输入/输出 hash，将 `world-archive/1` 转为 `world-backup/1`。它无损封装原记录，不能修补缺失的语义证据。未知必需 Session 事件被拒绝；明确可忽略的原记录保留。新的业务 schema 转换必须具备独立的证据保留测试，不能从这一封装转换推导。

发布在 staging 校验和 fsync 后使用排他内容地址链接，并发重试无法覆盖此前成功的包。完整包包含私密历史正文，采用仅所有者可访问的明文存储；部署可在格式之外加密，密钥必须单独保管。脱敏数据集不能声称具有可写等价性。历史 cwd 保留为来源证据，执行前要求显式目标路由；凭证和可执行 Host 配置不进入包。导入在 staging 验证已安装的所有者 parser，不启动角色或真实适配器。完整 Product bundle 还绑定原始且已完成的创建或分支命令帧，两者保持独立族；分支导入不补造 world-create 预检批准。仅 Host 可用的 Product 恢复 helper 校验精确原 Native 前缀和相同 principal，以一次日志追加导入原帧，并在目录发布前登记 paused 发现记录。目标路由仍由部署负责；其他 Product administration 请求历史不属于这一创建来源证据契约。

普通 `world-backup/1` 包拒绝当前运行及全部来源祖先中的联邦时间证据，也拒绝所给 snapshot 不一致而隐藏日志证据的情形。原所有者归档仍可组合使用，但自包含联邦恢复要求完整联邦 checkpoint 和对应 mailbox 前缀证明。封装迁移不能删除该依赖或补造时间权限。

## Alternatives considered

**仅复制 Native**遗漏标准认知和投递证据，不能证明引用感知保留成立。

**立即删除热前缀**要求所有现有读取者支持归档位置。首版 API 保留两份副本，不声称释放容量。

**在封装转换中重写旧业务记录**可能伪造批准或投递证据。支持的转换器只添加元数据，不支持业务版本迁移。

## Consequences

[双后端恢复测试](../../../../packages/simulation/simulation-team/tests/archive.spec.ts)在加载空目标所有者前让原路径离线，覆盖真实图像、空物化和未物化 Session、待执行计划、cwd 迁移、staging 失败、重试、缺失闭包和损坏对象。未知归档版本被拒绝；不支持部分保留、后代 Team 导出或自动删除热存储。宿主必须提供隔离目标组合并在发布前验证恢复闭包；原始不透明 JSON 不等于语义校验。

产品 retention 命令使用独立授权日志：accepted 记录保存原输入和完整归档字节，完成时发布原 hash。已接受但发布失败的重试从原字节恢复。私有归档分页复用当前完整记录权限，与运行所有权分离。静止预览不调用阶段管理或角色退休。

[备份格式测试](../../../../packages/simulation/simulation-team/tests/backup.spec.ts) 覆盖完整字节边界、manifest 篡改、脱敏/配置拒绝、精确转换计划和未知必需事件。双后端 Loader 恢复测试还覆盖完整 bundle 发布、并发重试、损坏目标拒绝、离线转换和源包保留，再从源路径不可访问的环境恢复。缺少自定义领域/provider 引用契约时拒绝，不能宣称可移植。

[Product Loader 与进程测试](../../../../packages/simulation/simulation-product/tests/backup-import.spec.ts) 在 Product 日志/目录登记后、发布前终止真实目标进程，再以新 staging 根恢复并重新打开 paused 发现目录。源路径已离线，原始命令仍可读取，显式 restore 使用新导入锚点。
