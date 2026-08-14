# dsh-deepseek-billing

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Web 设置页里显示
DeepSeek 账户余额。

- **宿主半**：提供 `deepseekBilling` 服务（真实余额 fetch）＋ JSON 路由
  `GET /api/deepseek-billing/balance`
- **客户端半**：在设置页注册「计费」区块，展示可用 / 充值 / 赠送余额，支持手动刷新；
  通过 DSH 的 `locale` 服务提供中英文双语（`settings.billing` 命名空间），导航、正常 / 加载 / 错误文案和时间格式
  均随「设置 → 语言」实时切换

## 安装

```bash
dsh plugin --profile web install github:golitter/dsh-deepseek-billing
```

安装后，包会因声明了 `dsh.bundle` 自动写入 profile 的 `dsh.profile.bundles`，
随 `dsh --profile web` 启动加载。**无需 `--patch`，也无需手动建符号链接。**

## 配置凭证

余额接口需要 `DEEPSEEK_API_KEY`。把它写进凭证库 `$DSH_HOME/.credentials.yaml`（一个
「凭证名 → 值」的 YAML 映射）：

```yaml
DEEPSEEK_API_KEY: sk-xxxxxxxxxxxxxxxx
```

写好后重启 web 进程生效。

## 使用

1. 启动 web：`dsh --profile web`
2. 打开 **设置 → 计费**
3. 查看余额，点右上角 **刷新** 重新拉取

## 结构

```
├── package.json        # dsh.bundle（bundle patch）+ dsh.client（客户端面）
├── cordis.patch.yml    # bundle patch：按包名插入自身
└── lib/
    ├── index.js        # 宿主半：服务 + 路由
    └── client.js       # 客户端半：设置页 UI（window.__ModuleLoader__.load）
```

## 国际化

- 客户端接入 DSH 的 `locale` 服务（`inject: ['slots', 'locale']`），注册自己的
  `settings.billing` 命名空间词典：`zh` 为键集来源，`en` 与之一一对应。
- 所有界面文案经 `const t = ctx.locale.bind('settings.billing')` 翻译；侧边栏 label
  使用 thunk `label: () => t('nav')`，余额页通过 `ctx.locale.subscribe()` +
  `React.useSyncExternalStore` 订阅语言快照——切换中英文后页面即时重渲染，无需刷新。
- 服务端只返回稳定错误码（`missing_credential` / `balance_timeout` /
  `balance_fetch_failed` / `billing_service_unavailable` / `invalid_response`），
  客户端再按当前语言翻译，避免英文界面出现中文报错。

## 开发

- 改客户端 UI → 改 `lib/client.js`，重启 web 生效（客户端 bundle 无 HMR）。
- 改路由 / 服务 → 改 `lib/index.js`。
- 依赖的服务（`credentials`、`webServer`）和客户端注入包
  （`@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-locale`、
  `@deepseek-ai/dsh-client-ui-settings-general`）
  都是 DSH 部署自带的，通过 `peerDependencies` 声明即可，无需随包分发。
