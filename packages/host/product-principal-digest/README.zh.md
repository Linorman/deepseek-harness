# @clocky/clocky-host-product-principal-digest

[English](README.md) | 中文

`@clocky/clocky-host-product-principal-digest`通过把 product credential 的 SHA-256 摘要与已配置的非秘密摘要比较来进行认证。它不保留明文 credential、不写入状态，并为每次接受的认证签发可撤销 lease。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `sdk-digest` | SDK server 选择的 registry 名称。 |
| `credentialSha256` | 必填 | initialization credential 的小写 SHA-256 十六进制摘要。 |
| `principalId` | 必填 | 稳定的非秘密 product principal id。 |
| `subject` | 必填 | 稳定的非秘密 provider subject。 |
| `credentialGeneration` | `1` | 与已接受 lease 关联的非秘密 generation。 |

随附的 Python SDK runtime 接收 `CLOCKY_PRODUCT_CREDENTIAL_SHA256`；其父进程在从 child environment 移除明文 credential 后，依据显式 initialization credential 生成该值。配置摘要与 initialization credential 不一致时，会在 child launch 前拒绝。

## 模型体验

### Product 认证

#### 模型可见内容

该 provider 不注册 `prompt`、tool schema、model input 或 model output。

#### Token 影响

该 provider 增加零个 model token。

#### KV Cache 影响

它不修改 model-request prefix。

## 已知限制与延期工作

- 修改 digest、principal 或 generation 需要替换 provider；处置会撤销该 provider 的所有 live lease。
