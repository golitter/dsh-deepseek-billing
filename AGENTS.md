# AGENTS.md

## 项目简介

`dsh-deepseek-billing` 是 DeepSeek Harness（DSH）双端插件：宿主读取 DeepSeek API 余额并提供 `/deepseek-billing` 命令，客户端在“设置 → 计费 / Billing”展示余额，支持中英文实时切换。默认使用中文沟通，优先做最小、可验证的修改。

## 目录结构

```text
dsh-deepseek-billing/
├── lib/
│   ├── index.js              # 宿主：凭据、余额服务、HTTP 路由、斜杠命令
│   └── client.js             # 客户端：设置页、命令提示、样式和词典
├── test/
│   ├── index.test.js         # 宿主服务、路由、命令和配置测试
│   ├── client.test.js        # 客户端模块与契约测试
│   └── client-render.test.js # 余额页状态、刷新、取消和翻译测试
├── docs/design/              # 设计文档，入口见 docs/design/README.md
├── docs/README.en.md         # 英文 README
├── docs/*.png                # README 截图，不进入发布包
├── package.json              # DSH bundle/client 声明与包入口
├── cordis.patch.yml          # 宿主插件插入配置
└── README.md                 # 安装、配置和使用说明
```

真实入口只有 `lib/index.js` 和 `lib/client.js`，不要创建符号链接或写死本机路径。详细实现、运行契约和手动验证清单查阅 `docs/design/README.md`。

## 核心规则

- API Key 只能通过 `ctx.credentials.resolve('DEEPSEEK_API_KEY')` 获取并先 `trim()`；不得写入代码、日志、响应、文档、截图或测试数据。
- 保留请求超时/取消、HTTP/JSON/响应大小校验；余额为空返回 `null`，否则只返回 `currency`、`total_balance`、`granted_balance`、`topped_up_balance` 四个非空字符串字段。
- 不在启动时查询余额；本地路由只允许 `GET` 并保留 `Cache-Control: no-store` 和 browser-trust fence。
- 固定错误码为 `missing_credential`、`balance_timeout`、`balance_fetch_failed`、`billing_service_unavailable`、`invalid_response`；未知错误统一回退 `billing_service_unavailable`，不得暴露堆栈、路径或上游正文。
- `config.endpoint` 会收到 Bearer 凭据，属于受信任的宿主配置；变更其行为按公开接口变更处理。
- `/deepseek-billing` 必须复用 `deepseekBilling.getBalance()`、拒绝多余参数，并按宿主 `settings` 中的 `locale.preference` 本地化；语言不可用时使用稳定的英文/中性回退。
- 语言更新时重新注册命令；卸载时清理命令、监听器、请求、定时器和订阅。
- 客户端保留 `window.__ModuleLoader__.load(...)`、`require('react')` 及实际使用的 `slots`、`locale`、`sessions` 注入。
- 新请求和组件卸载前取消旧请求，禁止过期结果覆盖新状态；UI 只展示总余额、充值余额和赠送余额。
- 命名空间固定为 `settings.billing`；zh/en 键完全一致，所有可见文案使用 `t(key)`，侧栏使用 `label: () => t('nav')`，并通过 `useSyncExternalStore` 响应语言切换。
- CSS 使用 `ds-billing-` 命名，颜色跟随 `currentColor`；保留窄屏、焦点、禁用状态和 ARIA 支持。

## 修改与验证

- 保留用户已有改动，不处理无关文件；改变安装方式、公开接口、包名或删除文件前先征得同意。
- 标识符保持一致：包名、客户端模块 ID、patch `name` 为 `dsh-deepseek-billing`；宿主插件 `name`、patch `id` 为 `deepseek-billing`。
- UI、安装、错误码或配置变化时同步 README；UI 变化时更新截图；宿主/客户端变化同步对应测试和设计文档。
- 测试使用 Node.js 内置 `node:test`，不得依赖真实 DSH、DeepSeek 请求或 API Key；替换全局对象必须在 `finally` 中恢复。

至少运行：

```bash
node --test
node --check lib/index.js
node --check lib/client.js
node -e "JSON.parse(require('fs').readFileSync('package.json'))"
```

客户端测试不替代真实浏览器检查；发布或 UI 变更后仍需验证余额状态、刷新取消、语言切换、明暗主题、窄屏布局和 `/deepseek-billing` 命令生命周期。
