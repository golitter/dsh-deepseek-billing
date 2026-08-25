# 验证

> 对应原设计文档 §10。

## 10. 验证

### 静态检查

```bash
node --check lib/index.js
node --check lib/client.js
node -e "JSON.parse(require('fs').readFileSync('package.json'))"
node --test
npm run test:coverage
npm pack --dry-run
```

### 自动测试

```bash
npm test
# 或直接运行底层命令
node --test
```

测试使用 Node.js 内置 `node:test`，不依赖真实 DSH、真实 DeepSeek 服务或真实 API Key：

- `test/index.test.js`：30 个宿主端用例（含「fence 后每个 envelope 附带配置的 `timeoutMs`、fence 前 `403` 不附带」契约），覆盖凭据处理、五个固定错误码、缺失/未知 `.code` 兜底、完整响应超时（含「响应头已返回、响应体挂起」）、卸载时取消活跃上游请求、网络/HTTP 错误、非法响应、字段白名单与长度上限、64 KiB 响应体上限、空余额、GET/405/429/403 路由（403 返回 `{ ok:false, code }`）、browser-trust fence（Host 非 loopback、缺失 Host、cross-site、跨域 Origin、loopback-only 锁定不受 trusted authority 放宽）、限流（超限不再读取凭据或请求上游）、并发合并、`redirect: 'manual'`、endpoint 校验（默认锁定官方地址、`allowCustomEndpoint` 布尔校验、userinfo/fragment/非法 URL/非 loopback HTTP 白名单）、日志脱敏、`/deepseek-billing` 命令（zh/en 菜单说明与结果本地化、语言更新重注册、设置读取失败、语言中性回退、非字符串 `rawInput`）及配置边界，包括 `timeoutMs` 的上限和特殊数值。
- `test/client.test.js`：3 个可独立定位的客户端契约用例，通过真实模块工厂验证模块 ID、`require('react')`、服务注入、词典命名空间、zh/en 键集、动态侧栏标签、命令行插槽，以及 `/deepseek-billing` 回执的当前空白会话限定、成功/错误提示、会话激活清除、60 秒到期、切换清除、导航后过期回执丢弃、命令独占过渡帧和空白阶段历史命令隐藏。
- `test/client-render.test.js`：5 个余额页行为用例，以轻量 React hook harness 执行真实 `BillingSection`，分别验证加载/取消/合法成功响应和 ARIA、空余额与畸形响应、刷新失败保留最近成功余额及即时翻译、客户端超时呈现 `balance_timeout` 且可继续刷新、首次失败与卸载取消。
- `test/package.test.js`：发布元数据契约用例，验证 `0.1.1` 版本、Node.js 基线、DSH peer 范围、宿主硬依赖、可选 settings peer、客户端六项注入、入口/patch 标识、`repository`/`homepage`/`bugs` 及发布文件边界。

轻量 hook harness 能验证组件状态和请求生命周期，但不包含真实 React DOM、浏览器 CSS/布局与 DSH 完整装配。因此明暗主题、窄屏布局、焦点与 ARIA 的最终呈现，以及真实宿主中的 session/input 协作仍由下方手动清单验证；项目接入浏览器 CI 后再考虑加入完整渲染级测试。

### CI 与覆盖率基线

`.github/workflows/ci.yml` 在 Node.js `22.19.x` 和 `24.x` 矩阵中运行 `npm test`、`npm run test:coverage`、两个入口语法检查、`package.json` 解析和 `npm pack --dry-run`。覆盖率只用于观察趋势，当前不设置阻断阈值；测试过程不读取真实 DSH home、API Key 或 DeepSeek 服务。

### 浏览器与 DSH 装配自动化决策

本轮阶段 D 的可行性结论是：仓库没有锁定的浏览器测试依赖、浏览器运行时或本地 `dsh` 命令，且项目没有构建链和 lockfile。将 Playwright 与 DSH CLI 直接加入 PR 必跑流程会引入较大的浏览器缓存、网络下载、版本耦合和维护成本；当前采用“Node.js CI 必跑 + 隔离临时 home 的发布前真实装配手动检查”。轻量 harness 只证明模块和状态契约，不冒充真实 DOM/DSH 装配证明。未来若 DSH 提供稳定的测试装配入口，再把下方清单迁移为定时或发布任务，仍须使用临时 home、受控 loopback mock 和虚假凭据。

### DSH 0.1.1-rc.2 真实装配

使用隔离的 DSH home 和 `web` profile，确保验证不会修改日常 profile：

```bash
DSH_RC2_HOME="$(mktemp -d)"
DSH_HOME="$DSH_RC2_HOME" npx --yes @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add "link:$PWD"
DSH_HOME="$DSH_RC2_HOME" npx --yes @deepseek-ai/dsh@0.1.1-rc.2 --profile web
```

确认启动日志没有 peer dependency、client module、missing service 或 pending fiber 错误，并检查“设置 → 计费 / Billing”、versioned credentials、余额状态、刷新取消、zh/en 切换、主题/窄屏布局和 `/deepseek-billing` 命令生命周期。通过 LAN/远程 authority 打开 Web UI 时，普通页面按部署配置工作，但余额请求必须返回 `403`；验证使用专用测试凭据或受控 loopback mock，不使用真实生产账户。结束后只清理本次 `mktemp` 创建且已核实的临时目录。

### 手动检查清单

- 正常余额：显示可用 / 充值 / 赠送余额与「最后更新」时间。
- 缺失凭据：显示「未配置 DeepSeek API 密钥」（zh）/ 对应英文（en），而非原始异常。
- 刷新：点击刷新，旧结果保留、按钮进入「刷新中…」；连续刷新或离开页面后，旧请求不得覆盖新状态。
- 刷新失败：已有余额时保留余额和最后更新时间，显示非阻塞的本地化提示；首次失败仍显示完整错误态；下一次成功后提示消失并更新时间。
- 中英文切换：导航、标题、按钮、加载/错误态、时间格式即时切换，无需刷新。
- 明暗主题：颜色跟随 `currentColor` 自动适配。
- 窄屏（≤620px）：header 与 breakdown 纵向布局正常。
- 无障碍：section 的标题关联、加载/刷新期间 `aria-busy`、成功/空态/刷新提示的单一 polite live region、首次错误的 `role="alert"`、刷新按钮的键盘焦点与禁用语义均正确。
- 斜杠命令：`/deepseek-billing` 在宿主持久化语言为 zh/en 时使用对应菜单说明、主标签、空态和错误文案；切换语言后菜单说明无需重启即可更新；无可用偏好或设置读取失败时使用英文菜单说明及语言中性文本/稳定错误码。
- 空白会话命令：在全新空白会话中执行 `/deepseek-billing`，Hero 应保持不变，余额/错误显示在输入框旁的临时提示中，且只有一次上游查询；发送普通消息激活会话时提示应立即消失，空白阶段的命令历史卡不得出现；静置 60 秒后提示也应自动消失，切换到其他会话再返回新建会话时不得重新出现。已激活后执行 `/deepseek-billing` 时结果行仍应正常显示。
- 命令参数：直接输入 `/deepseek-billing` 正常查询；附加任意非空参数时返回本地化用法错误，且不发起 DeepSeek 请求。

### 验证约定

Web profile 挂载了客户端 HMR，会轮询当前已加载包的 `lib/client.js`；只有当该文件就是正在编辑的文件（例如本地链接安装）时，修改才能实时生效。GitHub 安装产生的是 profile 内副本，本仓库改动不会自动同步，需要重新安装/更新并重启 DSH Web；浏览器仍显示旧版本时再使用 `Ctrl+F5`。zh/en 键集一致性由客户端契约测试自动检查。
