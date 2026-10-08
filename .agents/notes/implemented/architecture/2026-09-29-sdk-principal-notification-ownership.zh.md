# Agent Note: 主体持有的 SDK 通知流

Status: implemented

[English](2026-09-29-sdk-principal-notification-ownership.md) | 中文

## 问题

已初始化的 SDK 连接与其他主体的 Team 和 Session 共享运行时。初始化认证不授权全局通知；事件等待 provider IO 或输出背压期间，成员权限或凭据可能已退役。

## 决策

SDK Team 和频道通知在发布前复查当前直接成员或规范父团队读取权限。Session 通知在产生时捕获归属，验证持久成员／Session 关系，解析仅有父关系的祖先链，不允许 header 自授访问。缺失、循环或未绑定的祖先关系不会送达。

父会话查询通过 `ctx.get()` 读取 `sessions`，因为 SDK 服务插件没有声明 Session 注入。持久化回退也使用同一个可选服务存储。通知插件的作用域上下文必须避免通过受拓扑影响的属性代理读取这些服务，否则合法子会话的通知会导致流失败并撤销认证连接。

内部远程 activation 记录属于接纳其精确 target 的主体。Session 事件只有在来源是记录持有的精确已发布 Agent Session 时才使用这项权限。驻留 activation 身份阻止主体变更；其他主体不能检查或重新打开 offline 记录。这项权限不需要子进程挂载 Team Hub，也不授权管理其他 Session。

一个串行队列在鉴权和传输排空期间保留通知。部署帧数和字节额度包含当前处理包、完整 JSON-RPC 包装、UTF-8 和换行。超限或未预期的发布失败取消输出排空等待、终止通知流、释放插件根并以代码 1 退出，不随意丢弃中间包。重新初始化丢弃前一代际；旧响应或失败不能发布到替换后的连接。管理响应返回前也检查其持有的 lease。Team 最终结果等待已受理通知，使 SDK 在关闭订阅前完成 transcript 收集。

产品主体 lease 提供不含身份的退役信号，调用间隙也有效。撤销立即触发该信号和在途调用信号，再等待已受理调用结束后释放 provider 资源。凭据／provider 退役时 SDK 停止空闲通知流；替换或释放 lease 前移除信号监听器。发布和传输持有者失败只暴露不含凭据的诊断。

## 考虑过的替代方案

**只认证一次并广播所有运行时事件。** 凭据识别主体，不提供所有 Team 的成员资格。

**用匹配的 Session ID 授予远程权限。** 具有相同 header 的另一 Session 对象可以冒充已接纳的 epoch；记录必须持有精确的已发布来源。

**已受理调用结束时才通知退役。** 空闲连接不会失效，等待中的流可能无限阻止资源释放。

**只限制排队 payload。** 当前鉴权／写入包、JSON-RPC 包装和多字节文本可能超过实际保留额度。

## 影响

管理通知要求与管理请求相同的读取 provider；内部 placement 保留独立的精确 epoch 权限。拒绝读取的事件不送达；未预期 provider 失败终止通知流，需要重新初始化。[SDK reader 决策](2026-09-28-sdk-principal-team-readers.zh.md) 继续负责请求和目录语义，[远程 placement](2026-08-28-sdk-remote-agent-runtime-placement.zh.md) 继续负责 activation 生命周期和 Link 归属。两者仍是有效决策来源。

## 验证

真实 Hub 测试在没有 Session 注入的插件上下文中创建服务实例。

真实 Hub 测试覆盖双主体、Team／频道／Session 过滤、祖先关系、IO 期间成员撤销、空闲与在途凭据／provider 退役、代际替换和帧数／字节超限。远程生命周期测试覆盖精确 Session 归属、主体变更及终态记录。队列测试固定顺序、传输排空、精确 UTF-8 额度与回调隔离；主体测试固定立即取消与延迟 provider 释放。keyless JSON-RPC Team-final 场景覆盖完整传输组装和持久结果路径。
