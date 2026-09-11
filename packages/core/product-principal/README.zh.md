# @clocky/clocky-product-principal

[English](README.md) | 中文

`ctx.productPrincipals` 是经过认证的产品 principal seam。传输层在凭据边界选择具名 provider，获得可撤销 lease，并通过一个新的仅运行时 `AuthenticatedProductCall` 执行每次受保护的分发。

Provider 只暴露非秘密 principal 事实：带品牌的稳定 id、issuer、subject、assurance 和 credential generation。注册表不会序列化凭据或 provider 错误；provider 退役时它停止新工作，并在已接纳调用结束后撤销每个 lease。

## API

- `registerProvider(provider)` 贡献一个 effect 作用域内的具名认证器。
- `bootstrapCredential(provider)` 只向受信任的传输 owner 返回 provider 所有的 bootstrap secret。
- `authenticate({ provider, credential, signal? })` 返回 `AuthenticatedProductPrincipalLease`。
- `lease.withCall(operation, signal?)` 提供受保护分发器唯一应接收的 `AuthenticatedProductCall`。

## Model Experience

### Product authentication

#### What the model sees

没有 product principal、credential、digest 或 `AuthenticatedProductCall` 对模型可见。

#### Token effect

此 seam 不增加模型 token。

#### KV Cache effect

它不增加模型请求前缀。

## Known Limitations and Deferred Work

- 此 seam 只认证并撤销运行时调用；Team principal ownership 和 human actor-proof binding 属于它的 Consumer。
