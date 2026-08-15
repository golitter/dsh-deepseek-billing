# 验证

> 对应原设计文档 §10。

## 10. 验证

### 静态检查

```bash
node --check lib/index.js
node --check lib/client.js
node -e "JSON.parse(require('fs').readFileSync('package.json'))"
```

### 自动测试

```bash
npm test
# 或直接运行底层命令
node --test
```

测试使用 Node.js 内置 `node:test`，不依赖真实 DSH、真实 DeepSeek 服务或真实 API Key：

- `test/index.test.js`：28 个宿主端用例，覆盖凭据处理、五个固定错误码、缺失/未知 `.code` 兜底、完整响应超时（含「响应头已返回、响应体挂起」）、网络/HTTP 错误、非法响应、字段白名单与长度上限、64 KiB 响应体上限、空余额、GET/405/429/403 路由（403 返回 `{ ok:false, code }`）、browser-trust fence（Host 非 loopback、缺失 Host、cross-site、跨域 Origin、loopback-only 锁定不受 trusted authority 放宽）、限流（超限不再读取凭据或请求上游）、并发合并、`redirect: 'manual'`、endpoint 校验（默认锁定官方地址、`allowCustomEndpoint` 布尔校验、userinfo/fragment/非法 URL/非 loopback HTTP 白名单）、日志脱敏、`/deepseek-billing` 命令（zh/en 菜单说明与结果本地化、语言更新重注册、设置读取失败、语言中性回退、非字符串 `rawInput`）及配置边界。
- `test/client.test.js`：1 个客户端契约用例，通过真实模块工厂验证模块 ID、`require('react')`、服务注入、词典命名空间、zh/en 键集、动态侧栏标签，以及 `/deepseek-billing` 回执的当前空白会话限定、成功/错误提示、会话激活清除、60 秒到期、切换清除和导航后过期回执丢弃。

客户端契约测试不渲染 `BillingSection`，因此 fetch 生命周期、卸载取消、刷新交互、状态渲染和时间本地化仍由下方手动清单验证。只有当 UI 频繁变化、出现真实回归或项目接入浏览器 CI 时，再考虑引入渲染级测试。

### 手动检查清单

- 正常余额：显示可用 / 充值 / 赠送余额与「最后更新」时间。
- 缺失凭据：显示「未配置 DeepSeek API 密钥」（zh）/ 对应英文（en），而非原始异常。
- 刷新：点击刷新，旧结果保留、按钮进入「刷新中…」；连续刷新或离开页面后，旧请求不得覆盖新状态。
- 中英文切换：导航、标题、按钮、加载/错误态、时间格式即时切换，无需刷新。
- 明暗主题：颜色跟随 `currentColor` 自动适配。
- 窄屏（≤620px）：header 与 breakdown 纵向布局正常。
- 斜杠命令：`/deepseek-billing` 在宿主持久化语言为 zh/en 时使用对应菜单说明、主标签、空态和错误文案；切换语言后菜单说明无需重启即可更新；无可用偏好或设置读取失败时使用英文菜单说明及语言中性文本/稳定错误码。
- 空白会话命令：在全新空白会话中执行 `/deepseek-billing`，Hero 应保持不变，余额/错误显示在输入框旁的临时提示中，且只有一次上游查询；发送普通消息激活会话时提示应立即消失，静置 60 秒后也应自动消失，切换到其他会话再返回新建会话时不得重新出现。
- 命令参数：直接输入 `/deepseek-billing` 正常查询；附加任意非空参数时返回本地化用法错误，且不发起 DeepSeek 请求。

### 验证约定

Web profile 挂载了客户端 HMR，会轮询当前已加载包的 `lib/client.js`；只有当该文件就是正在编辑的文件（例如本地链接安装）时，修改才能实时生效。GitHub 安装产生的是 profile 内副本，本仓库改动不会自动同步，需要重新安装/更新并重启 DSH Web；浏览器仍显示旧版本时再使用 `Ctrl+F5`。zh/en 键集一致性由客户端契约测试自动检查。
