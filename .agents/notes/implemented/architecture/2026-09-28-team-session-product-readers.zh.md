# Agent Note：Team Session 读取与持有的产品观察者

Status: implemented

[English](2026-09-28-team-session-product-readers.md) | 中文

## 问题

Team 成员链接会进入通用 Session API 与聚合订阅。仅过滤 Team 页面，仍可能让另一主体读取 Session 正文、投影和排队事件。实时 header 表示归属，但不能证明持久 Team 绑定。认证主体变化后，客户端持有的 fiber 也可能继续显示旧数据。

## 决策

`session-content-read` 对完整 Team／成员／Session 元组计算 fingerprint。人工 binder 选择当前直接成员或规范父团队读取权限；Hub 另要求 Agent 成员的 activation reservation 或持久 activation binding 记录该 Session。历史绑定在当前权限下仍可读取。读取不激活成员、不恢复 Team，也不启动模型。

子代理 header 可能只带 `parentSession`。Host reader 沿不可变 header 查找最近的显式 Team 所有者或独立根；缺失父记录或循环链拒绝正文访问。在 Team 成员准确绑定的 Session 上检查当前权限，列表条目保留派生 Team 身份供撤销时清理。显式 Team 元数据仍要求自身绑定，不能借用不同祖先的身份。

Host 历史、模型元数据与图片读取，在 IO 期间保留此 proof，并在发布前再次检查，包括失败读取。Session 列表与搜索在投影或冷正文探测前排除未授权 Team 绑定。成员资格与规范委派变化使在途聚合响应失效。独立 Session 保留既有 Host 访问语义。

Mux 与 Host 队列在发出时捕获不可变 Session 归属，包括 disposal；每帧在送达前立即鉴权。Team／频道事件使用当前 Team 读取权限。单个 reader lease 固定传输主体，在认证撤销或 binder unload 时结束订阅，包括空闲订阅。数量和字节额度是经过校验的部署配置；超限清空积压并终止订阅，消费者随后重连并重新读取。此前可见 Team 的帧被拒绝时，`team/access-revoked` 只发出其已知身份。

HTTP 读取通道 dispatch 和 WebSocket source 打开均传递完整的已认证调用。WebSocket 在 upgrade 后于该调用下打开 source；只转发 abort signal 会丢失主体。网关 root 从与 API 实现相同的 bundle 导出共享调用上下文。独立打包的上下文会向 API 从不读取的另一个实例签发事实。

认证退役以协议码 `4001` 关闭下行；浏览器丢弃排队帧并报告结构化访问失效。HTTP 401／403 与明确的产品拒绝区别于普通网络失败。连接控制器在 Host 描述与授权重置完成前保留帧，拒绝已退役代际的帧，每代际只报告一次拒绝。该信号清理 Session 正文／fiber、Team 数据与本地首次输入草稿，以及工作区元数据，并隔离未完成响应。普通断线保留此前可读内容。

Session 所有的转发事件使用相同的当前正文权限。Preset 变化携带 Session 身份；激活请求／结果、package 公布／撤回和 inspect-query 结算从持有的生产者记录派生 `agentId`。每条通知可独立检查，包括请求已移除之后。未知冷身份须查询元数据，不能作为公共事件送达。命令、凭据引用、adapter 和 settings 通知保留 Host 元数据语义；转发名称与参数原样保留。

Session runtime 在 Team 撤销后清理相关视图、持有 fiber 和缓存。Host 授权 scope 变化时，在发布下一份已认证列表前清理全部 Session 状态。代际检查阻止旧列表响应重新填充该状态。这些规则补充[目录与字节读取决策](2026-09-28-principal-team-directory-and-readers.zh.md)，不替代 Team 修改或邀请授权。

工作区响应和排队快照按当前正文权限过滤 Session 与归档引用。已知不可访问引用在 registry 修改前拒绝重排／归档。客户端工作区代际隔离未完成基线与修改回执；撤销引用不会由后到帧恢复，直到当前已授权基线恢复它们。工作区路径、标题和登记顺序仍是 Host 元数据。

ZIP 准备在正文 IO 前检查根元数据。每次后代和媒体读取在 IO 期间保留自身 Session 权限；共享媒体以最先引用它的 Session 为确定所有者。每个压缩块等待消费者容量后复查该所有者。撤销使归档失败，不发布有效的部分 ZIP。请求／认证／source 退役取消生产，完成或取消会退役 reader。导出失败不暴露 backend 诊断。

## 考虑的替代方案

**信任 Session header 内的 Team 身份。** 不匹配或未绑定 Session 会在没有 Team 持久关系时获得正文访问。

**只在打开订阅时鉴权。** 成员资格撤销前已排队的帧，会在权限失效后发布。

**将持有视图隐藏在客户端状态中。** 主体替换后重新打开视图，可能暴露前一主体的缓存数据。

**由根或图片 digest 授权整个归档。** 后代或共享媒体引用可能要求不同的当前权限；根和 digest 不能提供该关系。

## 影响

历史成员记录可在不执行模型的情况下检查。逐帧／块权限检查和冷祖先元数据读取增加工作；配置的队列上限不承诺吞吐性能。缺失祖先需在产品正文访问前修复。[SDK Team reader](2026-09-28-sdk-principal-team-readers.zh.md) 负责授权目录与选中读取；SDK 通知仍须独立审计。Simulation 的休眠冻结 Session 需要独立的 run-aware 产品权限。表单草稿保留与放弃规则仍由产品交互工作负责。

## 验证

真实 Hub 的 Host 测试覆盖双主体、Session 列表／正文、排队事件、转发 Session 通知、IO 撤销、空闲退役与队列超限。工作区和 ZIP 测试覆盖限定引用、修改响应、IO 前根拒绝、合法后代／媒体和缺失／循环祖先。载体／控制器测试验证认证 dispatch、退役协议码、明确拒绝和授权重置前保留帧。客户端测试覆盖缓存清理与旧基线／修改回执。当前构建的真实 Host 成员／child 导航、ZIP 和本地 provider 凭据轮换浏览器场景负责产品路径。
