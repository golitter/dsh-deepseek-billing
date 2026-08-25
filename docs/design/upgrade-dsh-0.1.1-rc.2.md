# DSH 0.1.1-rc.2 适配实施方案

> 状态：已实施。自动验证、发布包检查和 DSH `0.1.1-rc.2` 隔离 Web 装配均已完成；浏览器视觉与真实账户状态仍按手动清单在目标环境复核。
> 编写日期：2026-08-25。
> 上游基线：DeepSeek Harness `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`0.1.1-rc.2`）。
> 适用插件版本：计划从 `0.1.0` 升级到 `0.1.1`。

## 1. 结论与范围

本次适配是**发布元数据、安装说明和部署边界的同步更新**，不是宿主端或客户端的重写。

对 DSH `0.1.1-rc.2` 源码逐项核对后，下列运行契约仍可继续使用：

- `ctx.credentials.resolve(ref)` 仍返回 `{ value, source } | undefined`；
- `ctx.webServer.register({ kind: 'exact', path, handler })` 的路由契约未变；
- `ctx.commands.register()`、`CommandInvocation.rawInput` 与 `settings/updated` 仍可用；
- Host-backed 语言字段仍是 `locale.preference`；
- 客户端的 `locale.register/bind/subscribe/getSnapshot`、`command/executed`、session `binding/scope` 仍可用；
- `settings.section` 与 `conversation.chat.commandview` 插槽仍存在；
- `DisclosureRow`、`IconApiOutline14` 和 `StateDot` 仍从 `dsh-client-ui-primitives` 导出。

因此本次不改变余额字段、错误码、HTTP 路径、命令名、插件名、客户端模块 ID、请求取消策略或安全默认值。

## 2. 实施目标

1. 让包管理器明确识别插件支持 DSH `0.1.1-rc.2`，避免旧预发布范围产生 peer dependency 不满足。
2. 补全宿主端实际硬依赖，确保包声明与 `lib/index.js` 的 `inject` 一致。
3. 把新安装说明改为 DSH 当前的 versioned credentials 文档格式。
4. 删除“DSH 拒绝 `0.0.0.0`”这一过时事实，同时保持余额路由 loopback-only。
5. 增加发布元数据测试，并在真实 DSH `0.1.1-rc.2` Web profile 中完成一次装配验证。

## 3. 非目标

- 不把余额接口接入 DSH 的通用 Typert RPC；当前没有必要为只读单路由扩大改动面。
- 不允许 LAN/远程浏览器读取余额；`trustedHosts` 是 DNS-rebinding 防线，不是身份认证。
- 不修改 DeepSeek `/user/balance` 请求格式或新增消费历史、告警、趋势等功能。
- 不把 API Key 写进 settings、客户端 bundle、HTTP 响应、日志或测试夹具。
- 不改变 `config.endpoint` 的信任语义。

## 4. `package.json` 修改

### 4.1 版本与 Node.js 基线

将包版本改为 `0.1.1`，并声明与目标 DSH 相同的 Node.js 运行基线：

```json
{
  "version": "0.1.1",
  "engines": {
    "node": "^22.19.0 || >=24.0.0"
  }
}
```

`engines` 用于在安装期提前提示不受支持的 Node.js，而不是让插件自行兼容 DSH 已不支持的运行时。

### 4.2 DSH peer dependency 范围

把所有现有 DSH peer 从 `^0.1.0-rc.5` 更新为 `>=0.1.1-rc.2 <0.1.2`，并补充宿主硬注入对应的两个缺失包：

```json
"peerDependencies": {
  "react": "^18.2.0",
  "@deepseek-ai/cordis": "^4.0.1",
  "@deepseek-ai/dsh-credentials": ">=0.1.1-rc.2 <0.1.2",
  "@deepseek-ai/dsh-host-webserver": ">=0.1.1-rc.2 <0.1.2",
  "@deepseek-ai/dsh-commands": ">=0.1.1-rc.2 <0.1.2",
  "@deepseek-ai/dsh-client-runtime": ">=0.1.1-rc.2 <0.1.2",
  "@deepseek-ai/dsh-client-locale": ">=0.1.1-rc.2 <0.1.2",
  "@deepseek-ai/dsh-client-ui-conversation": ">=0.1.1-rc.2 <0.1.2",
  "@deepseek-ai/dsh-client-ui-commands": ">=0.1.1-rc.2 <0.1.2",
  "@deepseek-ai/dsh-client-ui-primitives": ">=0.1.1-rc.2 <0.1.2",
  "@deepseek-ai/dsh-client-ui-settings-general": ">=0.1.1-rc.2 <0.1.2",
  "@deepseek-ai/dsh-settings": ">=0.1.1-rc.2 <0.1.2"
},
"peerDependenciesMeta": {
  "@deepseek-ai/dsh-settings": {
    "optional": true
  }
}
```

选择 `>=0.1.1-rc.2 <0.1.2` 的原因：

- 接受同一 `0.1.1` 版本线上的后续 RC 和正式版；
- 不在未经验证时宣称兼容 `0.1.2`、其他后续预发布线或 `0.2.x`；
- 比精确锁死 `0.1.1-rc.2` 更适合作为 peer range；
- DSH 仍处于 developer preview，每次跨 minor/pre-release 版本线继续单独复核。

`settings` 保持可选：命令语言读取使用 `ctx.get('settings')`，服务缺失时已有稳定的英文/中性回退。`credentials`、`webServer` 和 `commands` 则是 `lib/index.js` 的硬注入，必须是普通 peer。

### 4.3 `dsh.client.inject`

本轮保留当前六项：

```json
"inject": [
  "@deepseek-ai/dsh-client-runtime",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-conversation",
  "@deepseek-ai/dsh-client-ui-commands",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-settings-general"
]
```

不额外加入 `@deepseek-ai/dsh-client-ui-slots`：插件没有直接 `require()` 它，`slots` Cordis 服务由 `dsh-client-runtime` 提供；当前 `exports.inject = ["slots", "locale", "sessions"]` 已准确表达激活依赖。

## 5. 凭据安装说明修改

### 5.1 中文 README

把 `README.md` 中的扁平示例：

```yaml
DEEPSEEK_API_KEY: sk-xxxxxxxxxxxxxxxx
```

替换为当前 versioned 文档格式：

```yaml
version: 1

refs:
  DEEPSEEK_API_KEY: sk-xxxxxxxxxxxxxxxx
```

示例后增加两点说明：

- 已存在的旧扁平文档会由 DSH 在启动时迁移；新文档应直接使用 `version: 1`/`refs` 格式。
- POSIX 上该文件应仅允许当前用户读取，例如 `chmod 600 "$DSH_HOME/.credentials.yaml"`；不要在文档中展示真实密钥。

### 5.2 英文 README

对 `docs/README.en.md` 做同构修改，保持中英文步骤、字段和安全含义一致。

### 5.3 不改变读取代码

`lib/index.js` 仍只执行：

```js
const credential = await ctx.credentials.resolve('DEEPSEEK_API_KEY')
const apiKey = typeof credential?.value === 'string' ? credential.value.trim() : ''
```

文件结构由 DSH credential provider 负责解析，插件不得直接读取 `.credentials.yaml`。

## 6. 网络与安全文档修改

### 6.1 替换过时描述

下列文件中“DSH 主动拒绝 `--host 0.0.0.0`”的表述需要删除：

- `docs/design/security.md`
- `docs/design/configuration-and-security.md`

统一替换为以下语义：

> DSH WebServer 当前允许绑定 `127.0.0.1` 或 `0.0.0.0`。非 loopback 部署需要由 DSH connection 层配置受信 authority；该信任列表只防御 DNS rebinding，不提供身份认证。余额路由携带凭据能力并返回账户数据，因此沿用 DSH 对 settings/credentials 等 privileged methods 的策略，独立保持 loopback-only。通过 LAN/远程地址打开 Web UI 时，“计费”页的余额请求会返回 403，这是有意的安全限制。

### 6.2 保持代码安全策略

`lib/index.js` 的以下行为不变：

- `exact` 路由自行执行 browser-trust fence，因为它优先于 DSH `/api` prefix 路由；
- 传入空 trusted authority 列表，只接受 loopback Host；
- 拒绝 `Sec-Fetch-Site: cross-site` 和跨 authority `Origin`；
- 在方法、限流、凭据解析和上游请求之前执行信任检查；
- 403 仍只返回 `{ ok: false, code: 'billing_service_unavailable' }`。

同步检查 `docs/design/host.md`、`docs/design/decisions.md` 和 `docs/design/limitations.md`，保留“余额路由不被 trustedHosts 放宽”的决策，但改用最新版 DSH 的部署背景解释，避免继续暗示整个 WebServer 只能绑定 loopback。

### 6.3 暂不支持远程余额

若未来确需 LAN/远程余额访问，应另立设计，不在本次升级中顺手放开。新设计至少需要：

1. 明确的用户/会话认证，而非仅检查 Host；
2. CSRF/Origin 策略；
3. 远程传输加密；
4. 余额数据的授权范围与审计策略；
5. 与 DSH 官方 privileged RPC 边界一致的复用接口。

在这些条件具备前，不把 `trustedHosts` 透传到余额路由。

## 7. 运行代码处理

### 7.1 `lib/index.js`

功能逻辑不改。只允许更新注释，使其准确表达：

- DSH WebServer 可以非 loopback 绑定；
- 本路由因属于 privileged balance plane 而主动限制为 loopback；
- 该限制是授权缺失时的安全选择，不是 WebServer 的能力限制。

不得借本次升级改变：凭据读取、endpoint 校验、redirect、完整响应超时、64 KiB 上限、字段白名单、并发合并、限流、错误码和日志脱敏。

### 7.2 `lib/client.js`

不改。最新版仍提供当前使用的 locale、sessions、notice、设置插槽和命令行插槽契约。只有真实装配测试发现具体不兼容时，才以最小改动修复，并同步客户端测试与设计文档。

## 8. 测试修改

### 8.1 新增包元数据测试

新增 `test/package.test.js`，至少断言：

- `name`、宿主插件 id、客户端模块 ID 没有变化；
- `version === '0.1.1'`；
- `engines.node` 与 DSH 目标基线一致；
- 所有 DSH peers 使用 `>=0.1.1-rc.2 <0.1.2`；
- `credentials`、`host-webserver`、`commands` 三个硬依赖存在；
- `settings` 被标记为 optional peer；
- `dsh.client.inject` 六项集合不发生意外增删；
- `exports['./client']` 和 `dsh.bundle.patch` 路径仍有效；
- `files` 不包含 `docs`、截图或测试。

### 8.2 保持现有契约测试

现有宿主和客户端测试继续运行，尤其保留：

- non-loopback Host 返回 403；
- trusted authority 不放宽余额路由；
- `command/executed` 只影响当前空白会话；
- 设置页和命令行插槽的注册/卸载；
- 语言更新重注册命令；
- 所有请求、定时器、订阅和命令注册在卸载时清理。

### 8.3 自动验证命令

```bash
node --test
node --check lib/index.js
node --check lib/client.js
node -e "JSON.parse(require('fs').readFileSync('package.json'))"
npm pack --dry-run
```

`npm pack --dry-run` 应确认发布包只有 `lib/`、`cordis.patch.yml`、`package.json` 及 npm 自动包含的必要元数据，不包含 README 截图和测试夹具中的模拟值。

## 9. DSH 0.1.1-rc.2 真实装配验证

自动测试使用模拟 Context，不能证明新版 Web profile 的模块图和浏览器渲染正常。发布前使用隔离的 DSH home 和其内的 `web` profile，避免修改日常 profile：

```bash
DSH_RC2_HOME="$(mktemp -d)"
DSH_HOME="$DSH_RC2_HOME" npx --yes @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add "link:$PWD"
DSH_HOME="$DSH_RC2_HOME" npx --yes @deepseek-ai/dsh@0.1.1-rc.2 --profile web
```

`0.1.1-rc.2` 的 `plugin` 子命令会直接调用 PATH 中的 `pnpm`；使用 Corepack 时应先确保 `pnpm` shim 可用。

`web` 是随附模板；隔离的 `DSH_HOME` 会让它在临时目录中初始化。`link:` 保证 profile 读取当前 checkout，而不是 pnpm 缓存中的同版本副本。验证结束后记录该临时目录的位置；清理前先确认它确实是本次 `mktemp` 创建的目录。

检查项：

1. 启动日志无 peer dependency、client module、missing service 或 pending fiber 错误。
2. “设置 → 计费 / Billing”可打开，初次进入才请求余额。
3. versioned credentials 文档能被解析；旧扁平文档的迁移行为与上游说明一致。
4. 正常、空余额、缺少凭据、超时和无效响应状态均显示稳定本地化文案。
5. 连续刷新与卸载能取消旧请求，旧结果不覆盖新状态。
6. zh/en 切换即时更新导航、正文、错误和时间格式。
7. `/deepseek-billing` 拒绝多余参数，空白会话仍使用临时 notice，激活后的命令行正常显示。
8. 明暗主题、≤620px 窄屏、键盘焦点、disabled 与 ARIA 表现正常。
9. loopback URL 可以读取余额。
10. 通过非 loopback/LAN authority 打开页面时，普通 DSH 页面按部署配置工作，但余额路由返回 403，且服务端不解析凭据、不发起 DeepSeek 请求。

验证期间不得使用真实生产账户；使用专用测试凭据或受控 loopback mock endpoint，并确保任何日志、截图和提交中都没有密钥。

### 9.1 本次执行记录

- `node --test`、两个入口语法检查、JSON 解析和 `npm pack --dry-run` 均通过；发布包共 5 个文件，不含 docs、截图或测试。
- 使用精确的 `@deepseek-ai/dsh@0.1.1-rc.2` CLI 和 `link:/home/leixu/yh/devprojects/dsh-deepseek-billing` 完成隔离 `web` profile 装配；启动日志没有 peer dependency、client module、missing service 或 pending fiber 错误。
- 临时 home `/tmp/dsh-deepseek-billing-rc2-exact.Uiligr` 的黑盒检查结果：首页 `200`，插件 client module `200`，loopback 余额路由在未配置凭据时返回 `502 missing_credential`，非 loopback `Host` 返回 `403 billing_service_unavailable`。未使用真实 API Key；验证结束后已清理该目录及配套临时 npm/corepack 文件。

## 10. 文件变更矩阵

| 文件 | 修改 | 必要性 |
|---|---|---|
| `package.json` | 版本、Node engine、DSH peers、缺失宿主 peers、optional settings | 必须 |
| `test/package.test.js` | 新增发布元数据契约测试 | 必须 |
| `README.md` | versioned credentials 示例与迁移/权限说明 | 必须 |
| `docs/README.en.md` | 英文同构更新 | 必须 |
| `docs/design/security.md` | 修正非 loopback 部署事实，保留余额 loopback-only | 必须 |
| `docs/design/configuration-and-security.md` | 同步使用侧安全说明 | 必须 |
| `docs/design/host.md` | 更新路由背景说明 | 必须 |
| `docs/design/decisions.md` | 更新 browser-trust 决策背景 | 必须 |
| `docs/design/limitations.md` | 明确 LAN UI 下余额 403 | 必须 |
| `docs/design/packaging.md` | 更新 peer 范围与硬/可选依赖说明 | 必须 |
| `docs/design/verification.md` | 增加 package 测试和 rc.2 装配清单 | 必须 |
| `lib/index.js` | 仅更新与部署背景有关的注释 | 建议 |
| `lib/client.js` | 无计划修改 | 不需要 |
| README 截图 | UI 无变化，因此不更新 | 不需要 |

## 11. 实施顺序

1. 修改 `package.json`，新增 `test/package.test.js`。
2. 运行静态检查和全部自动测试。
3. 更新中英文 README 的 credentials 示例。
4. 更新五份安全/部署相关设计文档和 packaging/verification 文档。
5. 再次运行全文搜索，确保没有遗留 `^0.1.0-rc.5` 或“拒绝 `0.0.0.0`”表述。
6. 执行 `npm pack --dry-run`。
7. 在独立 DSH `0.1.1-rc.2` Web profile 中完成真实装配验证。
8. 将 `docs/design/README.md` 的当前实现版本更新为 `0.1.1`，记录验证日期与上游 SHA。
9. 发布前检查 `git diff`，确认没有密钥、临时 profile 文件、截图或无关修改。

## 12. 完成标准

只有同时满足以下条件，才视为升级完成：

- package metadata 与 DSH `0.1.1-rc.2` 一致且无缺失硬 peer；
- 新旧凭据文档路径都有明确说明，新示例采用 versioned 格式；
- 所有文档不再声称 DSH 禁止 `0.0.0.0`；
- 余额路由仍为 loopback-only，所有原安全测试通过；
- `node --test`、两个 `node --check`、JSON 解析和 `npm pack --dry-run` 全部通过；
- DSH `0.1.1-rc.2` 真实 Web 装配无 pending/failed 插件；
- 手动验证覆盖余额页、刷新取消、语言切换、主题、窄屏和命令生命周期；
- 工作区中不存在真实 API Key 或与本次升级无关的改动。

## 13. 上游依据

- [DSH `0.1.1-rc.2` 根版本与 Node.js 基线](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/package.json)
- [credentials-local versioned 文档与旧格式迁移](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/credentials/credentials-local/README.zh.md)
- [WebServer 支持 `127.0.0.1`/`0.0.0.0`](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/host/webserver/src/index.ts)
- [DSH browser-trust fence 与 privileged methods 策略](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/connection/src/index.ts)
- [命令注册与 `CommandInvocation.rawInput`](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/interaction/commands/src/index.ts)
- [客户端 `command/executed` 契约](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-commands/src/client/service.ts)
- [`settings.section` 注册形态](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-settings-general/src/client/index.ts)
- [`conversation.chat.commandview` 契约](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/client/ui-conversation/src/client/contract/slots.ts)
