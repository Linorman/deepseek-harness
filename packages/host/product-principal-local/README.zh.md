# @clocky/clocky-host-product-principal-local

[English](README.md) | 中文

随附的本地 provider 在 Harness home 下持久化一个稳定的非秘密产品 principal。每次打开都会用新的 256 位 bootstrap credential 替换当前 credential，只持久化它的 SHA-256 digest 与单调递增 generation，并拒绝所有较早 credential。

`bootstrapCredential()` 只向受信任的传输 bootstrap owner 暴露明文。`authenticate()` 接受相同 credential 用于浏览器 bootstrap 或 SDK connection，返回不同的可撤销 provider lease，且不会在诊断或持久状态中包含提供的值。

## Configuration

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `local` | 此 provider 的注册表名称。 |
| `path` | `<CLOCKY_HOME>/product-principal.json` | 私有状态文件名。 |
| `clockyHome` | 解析后的 Harness home | 省略 `path` 时使用的 home。 |

## Model Experience

### Local credentials

#### What the model sees

此 provider 不注册 prompt、tool schema、result、credential 或 `ProductPrincipal` 模型输入。

#### Token effect

此 provider 不增加模型 token。

#### KV Cache effect

它不增加模型请求前缀。

## Known Limitations and Deferred Work

- 浏览器 cookie 签发、loopback bootstrap exchange 和 SDK handshake carriage 是传输 Consumer；单独挂载此 provider 不会实现它们。
