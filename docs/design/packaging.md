# 打包与分发模型

> 对应原设计文档 §4。双端实现分别见 [host.md](host.md) 与 [client.md](client.md)。

## 4. 打包与分发模型

包是「一个包、两个入口」的双端包，靠三处声明协同：

| 声明 | 位置 | 作用 |
|---|---|---|
| `exports["./client"]` | package.json | 指向 `./lib/client.js`，`clientModules` 据此定位客户端 bundle |
| `dsh.bundle.patch` | package.json | 指向 `./cordis.patch.yml`，安装后自动写入 profile 的 `dsh.profile.bundles` |
| `dsh.client` | package.json | 声明客户端平台与注入依赖，供 `clientModules` 扫描 |

### 4.1 宿主半如何被加载

`cordis.patch.yml` 按包名插入自身：

```yaml
- insert:
    - id: deepseek-billing
      name: 'dsh-deepseek-billing'
```

`dsh plugin --profile web add github:golitter/dsh-deepseek-billing` 会把 `add` 参数转发给 profile 目录里的 `pnpm`，随后 CLI 根据已安装包的 `dsh.bundle.patch` 声明，把包名追加进 `dsh.profile.bundles` 层栈；`dsh --profile web` 启动时逐层加载，宿主半 `lib/index.js` 被 cordis 加载。

### 4.2 客户端半如何被发现

DSH 的 `clientModules` 服务（Node 半）扫描宿主 Loader 里声明了 `dsh.client` 的包，流程为：

1. 校验 `dsh.client`（`platform: "web"`、`inject: string[]`）。
2. 解析 `exports["./client"]` 得到相对路径（本包为 `./lib/client.js`）。
3. 以包名为模块 id，把 bundle 通过 `/plugins/dsh-deepseek-billing/client.js?rev=<hash>` 提供给浏览器。
4. 把入口图注入 `index.html` 的 `<head>`，写成 `window.__DSH_BOOT__`，shell bundle 据此加载。

由于本包没有构建脚本，`client.js` 就是最终分发文件，`clientModules` 直接读 `lib/client.js`（无需 `pnpm run build`，也没有 `prepare` 脚本）。

### 4.3 三类「inject」的区别

容易混淆，务必区分：

- **`lib/index.js` 的 `export const inject`**：宿主端 Cordis 服务依赖，当前为 `credentials`、`webServer`、`commands`；其中 `settings` 通过 `ctx.get('settings')` 可选读取，不作为硬注入，缺失时命令回退中性文案。
- **package.json 的 `dsh.client.inject`**：客户端模块图边，值是**包名/模块 id**（`@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-client-ui-commands`、`@deepseek-ai/dsh-client-ui-settings-general`），决定浏览器端 bundle 的加载顺序。
- **`lib/client.js` 的 `exports.inject`**：cordis **服务**依赖，值 `["slots", "locale", "sessions"]`，决定浏览器端 cordis 上下文里可用哪些服务。
