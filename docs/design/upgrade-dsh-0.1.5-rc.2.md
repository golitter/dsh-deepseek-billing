# DSH 0.1.5-rc.2 兼容修复与 0.1.6 前瞻适配规划

> 状态：阶段 A 已实施并完成隔离 DSH 装配；真实浏览器交互验收仍需在发布前按清单执行。
> 编写日期：2026-09-20。
> 发布基线：DeepSeek Harness `0.1.5-rc.2`，上游 SHA `fb2c4b9e698e30edb738bca4cf0618587db7d203`。
> 前瞻核对：DeepSeek Harness `0.1.6-alpha.2`，上游 SHA `ddefc45fbc7f8e46dd73185e68295696d1297887`。
> 当前插件版本：`0.2.0`，只声明支持 `>=0.1.5-rc.2 <0.1.6`。

## 1. 结论与支持策略

本次升级不是单纯放宽 peer dependency。DSH 从 `0.1.1-rc.2` 到 `0.1.5-rc.2` 已发生三项与本插件直接相关的契约变化：

1. 客户端模块拆分，`@deepseek-ai/dsh-client-runtime` 已移除；`sessions`、`slots` 和 Chat slot 分别由新的模块提供。
2. Session snapshot 不再提供 `composerPhase` 和 `nodes`；空白状态改为 `blank`，对话节点迁入 Chat snapshot。
3. Web `/api` 已具有 Host/Origin fence 加启动 token、签名 Cookie 的认证边界；插件直接注册的精确 WebServer 路由会绕过认证。

因此采用两段式支持：

- **阶段 A（本计划的发布目标）**：完整支持并真实验收 DSH `0.1.5-rc.2`，peer 范围使用 `>=0.1.5-rc.2 <0.1.6`。
- **阶段 B（前瞻，不随本次发布承诺）**：跟踪 `0.1.6` 多 Session retain/release API；在 `0.1.6` 进入 RC 后重新核对并单独放宽范围。

不得把 `0.1.6-alpha.2` 纳入已发布 peer 范围。其客户端当前选择状态和 Session 生命周期仍在变化，提前兼容会让插件同时维护两套相互冲突的会话所有权模型。

建议将插件版本提升为 `0.2.0`：这是一次受支持 DSH 基线、客户端依赖图及余额路由安全边界的公开变更。若维护策略不准备发布新的 minor，最低也必须提升 patch 版本，不能在原 `0.1.1` 包内容下静默替换。

## 2. 已确认的不兼容点

### 2.1 包元数据与客户端模块图

当前 `dsh.client.inject` 和 peers 仍包含已移除的 `@deepseek-ai/dsh-client-runtime`。在 DSH `0.1.5` 中：

- `sessions` 由 `@deepseek-ai/dsh-api-session-controller` 的客户端半提供；
- `slots` 由 `@deepseek-ai/dsh-client-ui-renderer` 提供；
- `conversation.chat.commandview` 由 `@deepseek-ai/dsh-client-ui-chat` 声明；
- 设置区块仍由 `@deepseek-ai/dsh-client-ui-settings-general` 的设置外壳承载；
- `command/executed` 仍由 `@deepseek-ai/dsh-client-ui-commands` 发出；
- `DisclosureRow`、`StateDot`、`IconApiOutline14` 仍由 `@deepseek-ai/dsh-client-ui-primitives` 导出。

旧依赖不能只删除，必须同时补齐新服务提供方和 slot 所有者，避免客户端插件依赖偶然的 Web 默认组合传递加载。

### 2.2 空白会话命令提示

当前实现读取 `session.getSnapshot().composerPhase`。`0.1.5` 的 `SessionSnapshot` 已改用 `blank: boolean`，所以当前判断永远不能命中空白态，`/deepseek-billing` 的临时提示不会显示。

阶段 A 的最小修复是：

```js
if (session?.getSnapshot().blank !== true) return
```

订阅中的清理判断同样改为 `session.getSnapshot().blank !== true`。当前 `ctx.sessions.list.getSnapshot().current`、`binding()` 和 `scope()` 在 `0.1.5-rc.2` 仍存在，可在阶段 A 保留；不得据此宣称兼容 `0.1.6`。

### 2.3 命令历史行

当前 `BillingCommandRow` 从 `useSession(snapshot => snapshot.nodes)` 读取节点。`nodes` 已从 Session snapshot 移到 Chat snapshot，因此最新版会在命令行渲染时访问 `undefined.find()`。

阶段 A 改为使用 session-scope slot 已提供的 `useChat`：

```js
function BillingCommandRow({ node, useChat }) {
  const hiddenFromBlankSession = useChat((snapshot) => {
    const firstConversationNode = snapshot.legacy.nodes
      .find((candidate) => candidate.kind !== 'command')
    return firstConversationNode === undefined || node.seq < firstConversationNode.seq
  })
  // ...
}
```

只读取 `legacy.nodes` 是为了保持现有“首个普通内容之前的命令不进入历史卡片”语义；本次不重写为 keyed Chat store 遍历。若上游后续移除 legacy slice，再单独迁移，而不是在本轮同时扩大改动面。

### 2.4 余额 HTTP 路由绕过当前认证

当前插件通过 `ctx.webServer.register({ kind: 'exact', ... })` 注册 `/api/deepseek-billing/balance`，再自行复刻旧版 Host/Origin fence。DSH `0.1.5` 的 Connection 已为 `/api` 提供：

- Host/Origin 信任检查；
- 启动 token 换取签名 Cookie；
- Cookie 认证；
- 统一的 Fetch route 注册与卸载。

精确 WebServer 路由会先于 `/api` prefix 命中，从而绕过 Connection 认证。修复必须迁到：

```js
ctx.connection.fetch.register({
  path: '/api/deepseek-billing/balance',
  methods: ['GET', 'HEAD', 'POST'],
  requestBody: 'buffered',
  fetch: async (request) => { /* return Response */ },
})
```

注册 `HEAD` 和 `POST` 是为了让插件仍能对常见非 GET 请求返回明确 `405` 与 `Allow: GET`；真正的余额查询只允许 `GET`。Connection 不会把其他方法交给该 Fetch route，其他方法的状态由共享 `/api` carrier 决定，不再把“所有方法都必为 405”作为插件契约。

迁移后删除插件自建的 `readHeader()`、`parseAuthority()` 和 `isLoopbackApiRequest()`。`isLoopbackHost()` 仍保留给自定义上游 endpoint 的明文 HTTP 校验使用。

新的访问策略是：**凡是 DSH Connection 判定 authority 可信且浏览器认证有效的请求，都可读取余额**。不再额外硬编码 loopback-only。这样余额路由与 settings、credentials 等 Host API 使用同一个认证边界，也能正确继承 DSH 将来的受认证部署能力。

### 2.5 限流键迁移

Fetch route 的标准 `Request` 不提供 Node socket 的 `remoteAddress`，不能继续按 IP 分桶。为保留“不同已认证浏览器互不挤占额度”的语义，按以下顺序生成内存限流键：

1. 读取 `Cookie` header；
2. 用 SHA-256 计算不可逆摘要，只把摘要保存在限流 Map 中；
3. Cookie 缺失时使用单一 `authenticated-fallback` 桶；正常 Web 请求在进入 route 前已通过认证，因此该分支只用于测试或非 HTTP carrier。

不得保存、记录或响应原始 Cookie；日志测试要增加 Cookie 标记值，证明错误路径不会输出它。若实施时 Connection 提供了正式的认证主体标识，应优先使用正式标识并放弃本地摘要方案。

## 3. 实施目标

1. 在 DSH `0.1.5-rc.2` 中无旧包混装、peer 警告、missing service 或 pending client plugin。
2. 设置页的加载、刷新、取消、超时、错误和语言切换保持当前行为。
3. `/deepseek-billing` 在空白会话继续显示临时 notice，激活后执行则显示命令历史行。
4. 余额路由继承 DSH Connection 的 `403` trust fence 和 `401` 浏览器认证，不再自建认证边界。
5. 插件可以安全热卸载：路由、命令、监听器、请求、定时器、slot 和词典全部清理。
6. 中英文 README、设计文档和截图只描述真实的 `0.1.5` 行为。
7. 自动测试不再用 `composerPhase`、Session `nodes` 或旧 `client-runtime` 模拟出虚假的兼容性。

## 4. 非目标

- 不在本次发布中宣称支持 `0.1.6-alpha.2`。
- 不新增消费历史、余额趋势、告警、自动充值或 API Key 管理。
- 不改变 DeepSeek `/user/balance` 请求结构、字段白名单、64 KiB 上限或五个稳定错误码。
- 不把 API Key、Cookie、上游正文、堆栈或内部路径发送到浏览器或日志。
- 不把路由改成 JSON Typert RPC；余额读取是无参数 `GET`，Connection Fetch route 已提供合适边界。
- 不为兼容旧 DSH 在同一个发布包里保留 `webServer` 和 `connection` 两套路由实现。
- 不依赖未发布的上游源码路径或内部私有导出。

## 5. `package.json` 方案

### 5.1 版本与 DSH peers

建议版本：

```json
"version": "0.2.0"
```

所有 DSH peers 使用：

```text
>=0.1.5-rc.2 <0.1.6
```

宿主 peers：

- 保留 `@deepseek-ai/dsh-credentials`；
- 保留 `@deepseek-ai/dsh-commands`；
- 新增 `@deepseek-ai/dsh-client-connection`，对应 `connection` 服务；
- 移除不再直接使用的 `@deepseek-ai/dsh-host-webserver`；
- `@deepseek-ai/dsh-settings` 继续为 optional peer。

客户端 peers：

- 新增 `@deepseek-ai/dsh-api-session-controller`；
- 新增 `@deepseek-ai/dsh-client-ui-chat`；
- 新增 `@deepseek-ai/dsh-client-ui-renderer`；
- 保留 locale、conversation、commands、primitives、settings-general；
- 移除 `@deepseek-ai/dsh-client-runtime`。

若新增标准 `Config` schema，加入直接依赖：

```json
"dependencies": {
  "@deepseek-ai/schemastery": "^3.18.2"
}
```

不得依赖 DSH 对 schemastery 的传递安装。

### 5.2 `dsh.client.inject`

计划值：

```json
"inject": [
  "@deepseek-ai/dsh-api-session-controller",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-chat",
  "@deepseek-ai/dsh-client-ui-commands",
  "@deepseek-ai/dsh-client-ui-conversation",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-renderer",
  "@deepseek-ai/dsh-client-ui-settings-general"
]
```

这些是本插件实际依赖的服务提供方、slot 所有者和同步 `require()` 模块。即使 Web 默认 bundle 会传递加载其中一部分，也保留显式边，防止模块图因默认组合调整而偶然失效。

浏览器端 `exports.inject` 暂时保持：

```js
exports.inject = ['slots', 'locale', 'sessions']
```

阶段 A 仍通过 sessions 服务处理空白会话 notice；完成 `0.1.6` 的 session-scope 重构后再重新评估是否可移除 `sessions` 硬注入。

## 6. 宿主端修改

### 6.1 注入与路由

把：

```js
export const inject = ['credentials', 'webServer', 'commands']
```

改为：

```js
export const inject = ['credentials', 'connection', 'commands']
```

路由 handler 改用 WHATWG `Request` / `Response`。保留：

- `Cache-Control: no-store`；
- JSON `content-type`；
- 成功、上游失败、限流和方法拒绝 envelope 中的 `timeoutMs`；
- `GET` 前限流，限流前不读取凭据、不请求上游；
- 稳定错误码与脱敏日志；
- 组件卸载时取消上游请求。

认证失败的 `401`、不可信 authority 的 `403` 由 Connection 在进入插件 handler 前产生，因此不包含插件 envelope 或 `timeoutMs`。这应成为新的明确契约。

### 6.2 标准配置 schema

导出 `Config`，把目前 `apply()` 内的配置边界同步表达为 schema：

- `endpoint`: string，默认官方余额 URL；跨字段的官方地址/自定义开关关系仍由 `validateEndpoint()` 校验；
- `allowCustomEndpoint`: boolean，默认 `false`；
- `timeoutMs`: 有限数值，范围 `1..120000`，保持当前允许非整数毫秒值的公开行为；
- `maxRequestsPerMinute`: 正整数，默认 `30`。

`apply()` 中保留安全关键的防御性校验，避免手写测试 context 或未来 loader 行为绕过；schema 与运行时校验必须共享常量，不能形成两个不同上限。

### 6.3 日志

优先使用 `ctx.logger`（若当前注入 context 的公开 logger 契约可用），否则保留 `console.error`。无论采用哪一种，输出仍只能包含固定前缀、稳定 code 和可选数字 HTTP status，不记录：

- API Key；
- Authorization header；
- Cookie；
- endpoint/query；
- 上游响应正文；
- Error stack。

## 7. 客户端修改

### 7.1 Session 空白状态

将两处 `composerPhase === 'blank'` 迁移为 `snapshot.blank === true`。保留旧请求取消、notice 所有权检查和一分钟定时清理。

组件卸载与会话切换时仍只清理由本插件创建、且仍是当前值的 notice，不得清掉其他功能后来发布的提示。

### 7.2 Chat 节点来源

`BillingCommandRow` 从标准 slot props 接收 `useChat`，读取 `snapshot.legacy.nodes`。新增测试必须使用 DSH `0.1.5` 的真实 snapshot 形状：

- `SessionSnapshot` 只有 `blank` 等生命周期字段，不伪造 `nodes`；
- `ChatSnapshot.legacy.nodes` 承载命令与普通对话节点；
- 首个普通节点之前的 billing 命令隐藏；
- 激活后执行的 billing 命令显示；
- 其他命令不受本插件 keyed renderer 影响。

### 7.3 其他客户端契约

以下行为保持不变：

- `window.__ModuleLoader__.load(...)` 和 `require('react')`；
- `settings.section` 的动态 label；
- locale 词典键及 `useSyncExternalStore`；
- 设置页请求取消、过期结果抑制和 Host timeout 学习；
- `DisclosureRow` 命令展示；
- CSS 命名、明暗主题、窄屏、焦点、禁用与 ARIA。

## 8. DSH 0.1.6 前瞻方案

`0.1.6-alpha.2` 已移除 `SessionListState.current`，并要求消费者通过 `retain()` / `release()` 持有 Session generation。阶段 B 不应继续在全局 listener 中调用 `sessions.binding()` 和 `sessions.scope()` 借用未持有对象。

进入 `0.1.6` RC 后，按以下方向重新设计：

1. 在 `conversation.input.overlay` 等常驻 session-scope slot 注册一个返回 `null` 的控制组件。
2. 组件通过标准 props 获得 `sessionId`、`useSession` 和 `inputActions`，而不是从全局 sessions service 推断“当前会话”。
3. 组件订阅 `command/executed`，只处理与自身 `sessionId` 一致的 billing 结果。
4. 使用 `useSession(snapshot => snapshot.blank)` 判断空白态，并通过公开的 `inputActions.notify()` 发布提示。
5. 多个 Session UI 同时存在时，各自只处理自己的事件；卸载组件即解除订阅，不额外 retain Session。
6. 命令历史行继续通过 session-scope `useChat` 读取 Chat 数据。

当前 `0.1.6-alpha.2` 的公开 `inputActions` 有 `notify()`，但没有明确的“只清理指定 notice”操作。要保留一分钟 TTL 和所有权安全清理，必须满足以下二选一条件后才能宣称兼容：

- 上游提供公开、带所有权或序号的 notice dismiss API；或
- 产品决策接受使用 DSH 原生 notice 生命周期，删除插件自定义一分钟 TTL。

不得为兼容 alpha 重新读取 `input.notices.set()` 等具体实现字段，也不得自行 retain 一个仅为了 UI notice 的 Session generation。

## 9. 测试计划

### 9.1 宿主单元测试

调整 fixture，使其提供 `connection.fetch.register()`，并直接取得 Fetch handler。至少覆盖：

- 路由路径、methods 和 `requestBody` 声明；
- GET 成功、空余额和五个固定错误码；
- HEAD/POST 返回 405 与 `Allow: GET`，且不读取凭据；
- 限流在凭据读取和上游请求前生效；
- Cookie 摘要分桶，相同 Cookie 共用额度，不同 Cookie 分离；
- Map 和日志中不出现原始 Cookie；
- 认证/authority 不再由插件 handler 重复实现；
- route disposer、活跃请求和 timer 在卸载时清理；
- Config schema 默认值、边界值与非法值。

删除或改写旧的插件自建 browser-trust fence 测试。`401`/`403` 属于 Connection 集成边界，不能在绕过 Connection、直接调用 handler 的单元测试中伪造证明。

### 9.2 客户端测试

更新 client fixture 为 `0.1.5` 形状，至少覆盖：

- `dsh.client.inject` 不含 `client-runtime` 且包含新模块；
- `blank: true` 时 billing 命令结果进入 composer notice；
- `blank` 变为 `false`、切换会话、TTL 到期和卸载时清理；
- Chat legacy nodes 决定 billing 命令行隐藏或显示；
- 命令行渲染不访问 Session snapshot 的 `nodes`；
- 设置区块和 commandview slot 注册在卸载后消失；
- 原有加载、刷新、取消、超时、响应校验和语言切换测试继续通过。

建议新增一项静态契约测试，扫描 fixture 和运行代码，拒绝再次出现：

```text
composerPhase
sessionSnapshot.nodes
@deepseek-ai/dsh-client-runtime
ctx.webServer.register
```

扫描应针对精确语义或文件范围，避免文档中的历史说明造成误报。

### 9.3 自动验证与隔离装配结果

至少运行：

```bash
node --test
node --check lib/index.js
node --check lib/client.js
node -e "JSON.parse(require('fs').readFileSync('package.json'))"
npm pack --dry-run
```

再使用精确 DSH 版本完成隔离装配：

```bash
DSH_BILLING_HOME="$(mktemp -d)"
DSH_HOME="$DSH_BILLING_HOME" npx --yes @deepseek-ai/dsh@0.1.5-rc.2 \
  plugin --profile web add "link:$PWD"
DSH_HOME="$DSH_BILLING_HOME" npx --yes @deepseek-ai/dsh@0.1.5-rc.2 \
  --profile web --no-open --port 0
```

临时目录只在确认路径确由本次 `mktemp` 创建后清理。不得修改日常 DSH home。

已完成一次真实隔离装配：使用临时 `DSH_HOME`、本地 link 插件和 DSH `0.1.5-rc.2` 启动 `web` profile，安装与启动均成功，未出现 peer dependency、client module、missing service 或 pending fiber 错误。该结果证明组合与路由注册能够启动，不替代下方浏览器交互验收。

### 9.4 真实装配与浏览器验收

必须检查：

1. 安装、启动无 peer、client module、missing service、pending fiber 错误。
2. 未携带有效 DSH Cookie 请求余额路径时返回 `401`。
3. 不可信 Host/Origin 返回 `403`。
4. 通过启动 URL 完成认证后，未配置凭据返回 `502 missing_credential`；这证明请求已进入插件 handler。
5. 使用受控 loopback mock endpoint 验证正常余额、空余额、HTTP 错误、非法 JSON、超限正文和超时；不得使用生产 API Key。
6. 设置页首次进入才发请求，刷新取消旧请求，过期结果不覆盖新状态。
7. `/deepseek-billing` 拒绝参数；空白会话显示临时提示，激活后执行显示历史行。
8. zh/en 即时切换，菜单说明、余额页面、错误和时间格式一致。
9. 明暗主题、窄屏、键盘焦点、disabled 和 ARIA 表现正常。
10. 通过插件管理或 profile 热更新停用/启用插件后，无重复路由、重复命令、残留 slot、旧 notice 或未结束请求。

## 10. 文档同步

实施时更新：

- `README.md`、`docs/README.en.md`：支持版本、认证后的路由行为和安装验证；
- `docs/design/packaging.md`：新 peers、client inject 与 `connection` 服务；
- `docs/design/host.md`：Connection Fetch route、Request/Response、认证和限流键；
- `docs/design/client.md`：`blank` 与 Chat snapshot；
- `docs/design/security.md`：启动 token、Cookie、Host/Origin 与敏感日志边界；
- `docs/design/configuration-and-security.md`：删除“Web 没有登录态”和硬编码 loopback-only 说明；
- `docs/design/decisions.md`：记录复用 Connection 认证的决策；
- `docs/design/limitations.md`：记录 `0.1.6` 尚未支持及 notice dismiss 缺口；
- `docs/design/verification.md`：新增真实认证、热卸载和新 snapshot 测试；
- `docs/design/structure.md`：加入本规划文档。

如果 UI 视觉没有变化，可以不更新截图；若命令 notice 或历史行外观变化，必须重拍中英文截图。

## 11. 文件变更矩阵

| 文件 | 计划修改 | 优先级 |
|---|---|---|
| `package.json` | 版本、peers、dependencies、client inject | P0 |
| `lib/index.js` | Config schema、connection Fetch route、限流键、删除旧 fence | P0 |
| `lib/client.js` | `blank`、`useChat(...legacy.nodes)`、新模块契约 | P0 |
| `test/index.test.js` | Fetch route、schema、Cookie 摘要及清理测试 | P0 |
| `test/client.test.js` | 新 client graph、slot 和 Session/Chat 契约 | P0 |
| `test/client-render.test.js` | 新 snapshot 形状及现有状态机回归 | P0 |
| `test/package.test.js` | 新版本线、peers 和发布边界 | P0 |
| 中英文 README | 支持范围与认证行为 | P1 |
| 主题设计文档 | 包装、宿主、客户端、安全、限制和验证同步 | P1 |
| README 截图 | 仅在可见 UI 变化时更新 | 条件性 |

## 12. 实施顺序与提交边界

建议按以下顺序实施，每一步都保持可审查：

1. **测试夹具对齐**：先把测试数据结构改成 DSH `0.1.5` 形状，使现有代码出现预期失败。
2. **客户端修复**：更新模块图、`blank` 和 Chat nodes，恢复客户端测试。
3. **宿主路由迁移**：接入 Connection Fetch route，重写路由测试并删除旧 fence。
4. **配置契约**：导出 Config schema，补充边界测试。
5. **元数据与发布边界**：更新版本、peers、inject 和 pack 测试。
6. **文档同步**：更新中英文 README 和全部受影响设计文档。
7. **隔离装配**：在精确 `0.1.5-rc.2` profile 中完成认证、余额页、命令和热卸载验收。
8. **最终审计**：全文搜索旧 API、检查发布包和 diff，确认没有凭据、Cookie、临时 home 或无关改动。

若使用多个提交，推荐边界为“测试契约”“客户端兼容”“认证路由”“元数据与文档”，不要把行为修复和大规模纯格式化混在一起。

## 13. 风险与回退

### 13.1 主要风险

- `dsh.client.inject` 遗漏模块，导致插件浏览器半 pending 或依赖默认 bundle 的偶然加载。
- Connection route 迁移改变非 GET 的状态码或响应 envelope。
- 认证前后的测试混淆：直接调用 Fetch handler 不能证明 `401`/`403`。
- Chat legacy slice 后续移除；当前只对 `0.1.5` 承诺。
- Cookie 限流摘要实现错误，导致跨浏览器共用额度或敏感值进入日志。
- 热卸载时嵌套 effect/disposer 未等待完成，重新启用发生重复 route。

### 13.2 回退原则

- 发布前失败：保留当前 `0.1.1` 分支，不放宽 peer，不发布半兼容版本。
- 路由迁移失败：不得回退到绕过认证的精确 WebServer 路由；应停止升级并修复 Connection 集成。
- 命令 notice 无法在公开 API 上维持所有权清理：可以临时移除“空白会话临时提示”功能并明确记录，但不得使用新版私有实现字段伪装兼容。
- `0.1.6` 适配失败不阻塞 `0.1.5` 发布；保持 `<0.1.6` 上界即可。

## 14. 完成标准

阶段 A 的代码实现与隔离装配已完成；发布前仍需完成以下浏览器验收项：

- 所有 DSH peers 为 `>=0.1.5-rc.2 <0.1.6`，且不存在 `dsh-client-runtime`；
- 宿主注入使用 `connection`，源码中不再注册精确 WebServer 余额路由；
- 客户端不再读取 `composerPhase` 或 Session snapshot 的 `nodes`；
- 热停用/启用后没有重复注册或残留异步工作；
- 认证、余额页、空白命令提示、语言切换、主题、窄屏和热停用/启用在真实浏览器通过；
- 仓库中不存在真实 API Key、Cookie、临时 profile 或无关修改。

阶段 B 只有在 `0.1.6` RC 发布、session-scope notice 方案可完全使用公开 API 实现并通过多 Session 实测后，才可另行完成并放宽 peer。

## 15. 上游依据

- [DSH `0.1.5-rc.2` release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2)
- [DSH `0.1.6-alpha.2` release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.2)
- [`0.1.5` Session snapshot](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/api/session-controller/src/client/contract/snapshot.ts)
- [`0.1.5` Session service](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/api/session-controller/src/client/contract/sessions.ts)
- [`0.1.5` Chat snapshot](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/client/ui-chat/src/client/contract/snapshot.ts)
- [`conversation.chat.commandview` slot](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/client/ui-chat/src/client/contract/slots.ts)
- [Connection Fetch route 与认证入口](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/client/connection/src/rpc-host.ts)
- [Connection Fetch route 公共契约](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/client/connection/src/rpc.ts)
- [内置认证下载路由示例](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/session-query/session-log-export/src/index.ts)
- [`0.1.6-alpha.2` retain/release Session 契约](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/api/session-controller/src/client/contract/sessions.ts)
- [`0.1.6-alpha.2` session-scope input actions](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/client/ui-conversation/src/client/contract/input.ts)
