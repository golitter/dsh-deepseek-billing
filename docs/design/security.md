# 安全与隐私

> 对应原设计文档 §9。配置项与安全边界的使用侧说明见 [configuration-and-security.md](configuration-and-security.md)，路由入口的安全设计见 [host.md](host.md) §5.4。

## 9. 安全与隐私

- 密钥只经 `ctx.credentials.resolve('DEEPSEEK_API_KEY')` 读取；DSH 凭证库负责持久化，插件自身不另行保存，也不写进代码、日志、响应、文档、截图或测试数据。
- 凭据会被发送到 `config.endpoint`；默认值是 DeepSeek 官方 HTTPS 地址。该配置属于受信任的宿主配置，不接受浏览器请求参数覆盖。宿主侧校验：`allowCustomEndpoint: false`（默认）时 `endpoint` 必须等于官方地址，设为 `true` 才允许自定义；始终拒绝内嵌用户名/密码、fragment 与非 `http(s):` 协议，明文 HTTP 仅限 loopback；`redirect: 'manual'` 阻止跨域重定向把 `Authorization` 带到新目标。自定义 endpoint（尤其是本地代理）会收到完整 Bearer Key，启用前需自行评估信任边界。
- **访问控制边界**：DSH Web 是绑定 loopback（`127.0.0.1`）的**单用户本地应用，没有登录态**；`--host 0.0.0.0` 被 DSH 主动拒绝，`webServer.register()` 不继承任何鉴权。因此插件未叠加自定义 Token 或会话鉴权，而是在路由入口复刻 DSH 自己的 `/api` browser-trust fence 并以**空信任列表锁定 loopback**（拒绝 cross-site、拒绝跨域 Origin），未通过返回 `403 { ok:false, code }`。这是「单用户 + loopback」部署下对高权限余额路由的轻量保护，`--trusted-host` 是 DNS-rebinding 白名单而非鉴权，故不放开余额。若未来 DSH 提供官方鉴权/会话边界，应改为复用而非自建密钥。
- 响应体流式读取并受 `MAX_RESPONSE_BYTES`（64 KiB）硬上限约束，超限返回 `invalid_response`，不把不受限正文缓冲进内存或转发给浏览器；余额字段另有 16/128 字符长度上限。
- 路由按客户端地址做每分钟固定窗口限流（默认 30 次），超限在读取凭据前返回 `429`；并发请求合并为一次上游请求。
- `Cache-Control: no-store` 阻止浏览器缓存余额。
- 错误响应不含堆栈、内部路径、上游正文；服务端日志只记录稳定错误码（及数值 HTTP 状态），不记录 API Key、`Authorization` 头、上游正文或完整 endpoint/query。
- 路由仅提供 `GET` 只读操作，不接受用户输入作为上游地址或请求头。
