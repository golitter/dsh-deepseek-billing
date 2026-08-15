# 配置与安全

## 配置

以下配置键均可选，写在插件宿主配置中。默认配置行为不变；已有自定义 `endpoint` 的配置需要显式增加 `allowCustomEndpoint: true` 迁移。

| 键 | 默认值 | 说明 |
|---|---|---|
| `endpoint` | `https://api.deepseek.com/user/balance` | 余额接口地址。`allowCustomEndpoint: false` 时必须是官方默认值。 |
| `timeoutMs` | `10000` | 覆盖完整请求的超时（响应头 + 响应体读取 + 解析 + 校验）。 |
| `allowCustomEndpoint` | `false` | 必须是布尔值 `true`/`false`。`false` 时锁定官方默认 endpoint；`true` 后允许自定义 `https:`，或 loopback 明文 HTTP 代理（`http://127.0.0.1` / `http://localhost`）。 |
| `maxRequestsPerMinute` | `30` | 每客户端每分钟的低频限流上限，超限返回 `429`。 |

启用本地 loopback 代理的示例：

```js
{
  endpoint: 'http://127.0.0.1:8080/user/balance',
  allowCustomEndpoint: true
}
```

## 安全边界

- API Key 只在宿主端经 DSH 凭证库读取，请求 DeepSeek 官方接口时以 `Authorization: Bearer` 发送，绝不写入日志、响应或发送到浏览器。
- **自定义 `endpoint`（尤其是本地代理）会收到完整的 Bearer API Key**，请在信任该目标的前提下再修改配置；默认锁定官方 HTTPS 地址，只有 `allowCustomEndpoint: true` 才允许改动，且始终拒绝内嵌用户名/密码、fragment、非 `http(s):` 协议、非 loopback 明文 HTTP，以及跨域自动重定向。
- DSH Web 是绑定 loopback（`127.0.0.1`）的单用户本地应用，没有登录态（`--host 0.0.0.0` 已被 DSH 主动拒绝）。余额路由读取 API Key、发起上游调用、返回账户数据，属高权限操作，因此复刻 DSH `/api` 的 browser-trust fence 并**锁定本机**：请求 `Host` 必须为 loopback、拒绝 cross-site 与跨域 `Origin`，未通过返回 `403 { ok:false, code }`。`--trusted-host`（DNS-rebinding 白名单，非鉴权）不放开余额。
- 余额响应体受 64 KiB 硬上限约束，余额字段受长度上限约束；服务端日志只记录稳定错误码，不含密钥、`Authorization` 头、上游正文或 endpoint query。
- 所有失败响应统一为 `{ ok: false, code }`，`code` 取固定错误码，客户端按当前语言翻译。

更完整的实现约束和设计取舍见 [设计文档](design.md)。
