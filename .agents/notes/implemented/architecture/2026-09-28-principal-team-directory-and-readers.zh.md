# Agent Note: 按主体隔离的 Team 发现目录与字节读取

Status: implemented

[English](2026-09-28-principal-team-directory-and-readers.md) | 中文

## Problem

未筛选的目录会暴露其他主体的 Team 元数据。即使筛选了条目，原始存储游标仍可能暴露隐藏日志名称。只有 channel ID 的请求需先读取归属才能检查成员资格；产物 provider 也可能在调用者失去权限后才完成读取。

## Decision

人工 binder 为目录签发可撤销、不可序列化的主体 reader。它记录主体、issuer、subject 与凭据代际，不授予成员资格或修改权限。Hub 检查配置允许的有限物理名称，解析规范读取成员资格，再在全部选中 Team 和祖先队列内发布安全摘要。最终发布复查 reader 和成员资格；认证被撤销时拒绝响应。元数据排除 grant、goal budget 正文及物理扫描计数。标题明确标记截断，目录行包含 Host 授权的直接成员或父团队检查状态。

产品续页使用每个 Hub 独有的 key 加密存储位置，并通过 authenticated data 绑定四项认证事实。Node 的[认证加密 API](https://nodejs.org/docs/latest-v22.x/api/crypto.html#ciphersetaadbuffer-options)提供 AES-256-GCM；游标不包含明文存储位置，也不使用服务端游标缓存。篡改、其他 reader、凭据变化或 provider 替换都会使游标失效，需明确重新读取首页。完整响应准入包含加密 token；超出页面额度的条目保留原扫描位置，单条无法容纳时拒绝。

`getChannelOwner()` 仅返回 provider 额度内、已挂载的 Team／channel 元组。产品原始读取和等待查询解析该归属，在读取期间保留当前成员证明，并在返回前复查。拒绝响应隐藏查询得到的 Team 身份。产物字节读取采用同样的前后检查，保留 provider 选择、可见性与字节限制。已过期的证明不能返回此前读出的字节。

[父团队检查决策](2026-09-28-parent-team-product-inspection.zh.md)继续拥有规范祖先关系及修改隔离；[有界读取决策](2026-09-01-bounded-team-control-plane-pages.zh.md)继续拥有内部回放分页与扫描计数。产品目录是采用加密游标和安全元数据的独立消费者。内部 provider 目录和既有 SDK 管理读取仍有各自的授权约定。

## Alternatives considered

**筛选条目但仍返回原 provider 游标。** 续页仍可还原隐藏存储名称。

**在服务端 map 保存每个续页。** 对可放入认证密文的位置增加保留、失效和容量责任。

**只在 provider IO 前检查成员资格。** IO 期间撤销会使已完成的读取暴露在失效权限下。

## Consequences

目录工作量和响应有界，不要求浏览器抓取所有分页。Provider 替换使未完成游标失效。权限查询可能加载选中 Team 的日志；响应额度不证明冷历史读取的性能。[Session 读取与持有观察者](2026-09-28-team-session-product-readers.zh.md) 负责 Team 正文、工作区引用、导出与逐帧权限。该决策也负责 Session 转发事件权限与明确认证失效后的缓存清理。[SDK reader](2026-09-28-sdk-principal-team-readers.zh.md) 覆盖其目录与选中读取；SDK 通知仍须独立审计。

## Verification

JSON 与 SQLite 委派测试验证直接成员／父团队目录访问。Host 测试覆盖跨主体筛选、续页复用、认证失效、原始频道拒绝和产物字节扣留。Cipher／分页测试覆盖上下文变化、provider 替换、篡改、空页续读、扫描推进及完整字节准入，单文件覆盖率为 100%。真实 Host keyless 集合与子团队导航场景在不增加模型请求的条件下使用产品目录。
