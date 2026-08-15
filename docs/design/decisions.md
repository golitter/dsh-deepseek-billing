# 关键决策与权衡

> 对应原设计文档 §8。安全相关决策的完整说明见 [security.md](security.md)。

## 8. 关键决策与权衡

1. **双端包而非两个包**：一个包同时声明 `dsh.bundle` 与 `dsh.client`，安装一次即完成宿主注入与客户端发现，避免用户分别安装。
2. **HTTP 路由只回错误码**：错误文案是客户端呈现层职责。若 HTTP 路由回本地化文案，英文界面会混入中文。稳定码 + 客户端翻译从根上消除该问题，代价是两端需维护一致的码表（`ERROR_CODES` ↔ `ERROR_KEY` ↔ 词典）。宿主斜杠命令没有客户端翻译层，因此直接按 Host-backed locale 返回可见文案。
3. **币种透传不做换算**：金额/币种是账户事实，任何「按语言换算」都会造成数据错误。代价是 `¥`/`$` 不按语言美化，改用 ISO 代码显示以保真。
4. **手动 `bind` + `useSyncExternalStore` 而非 slot 的 `locale:` 座位**：需要 `snapshot.active` 来按语言格式化时间，`useSyncExternalStore` 直接拿到 `active` 并驱动重渲染；slot 的 `locale:` 座位只注入 `t` 拿不到 `active`。
5. **`502` 作为统一失败态**：本地路由是上游代理，失败即「网关错误」，客户端不看具体 HTTP 状态码、只看 `code`。
6. **命令文案跟随 Host-backed locale**：`locale.preference` 存在宿主 `settings`，命令在宿主端直接读取它选择 zh/en 的发现菜单说明、主标签、空态、错误和用法提示；偏好更新时通过重新注册命令触发客户端目录刷新。`settings` 缺失、读取失败或偏好未知时回退英文菜单说明及语言中性文本/稳定错误码。命令不含「充值/赠送」明细，明细仍在设置页查看。
7. **超时覆盖完整响应**：把 `AbortController` 的生命周期延长到响应体读取、JSON 解析与校验完成之后，`clearTimeout` 只在最外层 `finally` 执行。否则服务器在返回响应头后可以无限缓慢地发送响应体，绕过「仅覆盖 fetch 阶段」的超时。
8. **受限读取 + 硬上限**：不直接 `response.json()` 不受限响应。先看 `Content-Length` 预拒绝，再流式读取并在 64 KiB 超限时中止，最后才 `JSON.parse()`；余额字段另设 16/128 字符长度上限。金额不做格式强校验，也不转 `Number`，避免精度损失。
9. **endpoint 收紧为「默认锁定官方地址」**：`allowCustomEndpoint: false`（默认）时 `endpoint` 必须等于官方 DeepSeek HTTPS 地址；设 `true` 才允许自定义（任意 `https:` 或 loopback 明文 HTTP 代理）。用户名/密码/fragment、非 `http(s):` 协议一律拒绝，`redirect: 'manual'` 保证跨域重定向不会把 `Authorization` 带到新目标。
10. **并发合并 + 低频限流**：同一时刻多个 `getBalance()` 只共享一次上游请求；路由按客户端地址做每分钟固定窗口限流（默认 30 次），超限在读取凭据之前直接返回 `429`。
11. **复刻 DSH 的 browser-trust fence 并锁定 loopback**：`exact` 路由在 webserver 匹配中优先于 `/api` 前缀路由，会绕过连接层自带的 fence，因此路由在入口自行复刻同一道「Host loopback + 同源」判定并返回 `403 { ok:false, code }`。余额读取 API Key、发起上游、返回账户数据，属于高权限操作，故用空信任列表锁定 loopback，与 DSH `credentials`/`settings` 平面一致，`--trusted-host`（DNS-rebinding 白名单，非鉴权）不放开它。
12. **空白会话使用临时命令提示**：不修改 DSH，也不把余额查询复制到客户端。插件只监听当前浏览器的 `command/executed` 回执，将自身命令文本送到当前空白会话的 composer notice；提示在会话激活、60 秒到期或离开会话时清除，导航后才返回的旧回执不再展示。Hero 和其他命令的持久化语义不受影响。
