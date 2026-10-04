# DSH 0.2.x 适配实施记录

> 发布基线：DeepSeek Harness `0.2.0-rc.2`（peer 范围 `>=0.2.0-rc.0 <0.3.0`），核对日期 2026-09-20。
> 当前插件版本：`0.3.0`。本文记录从 DSH `0.1.5-rc.2`（插件 `0.2.0`）升级到 DSH `0.2.x` 的契约变化与实施内容；`0.3.0` 及以上版本尚未纳入支持范围。

## 1. 升级动机

DSH `0.2.x` 将宿主 `settings` 服务从「按命名空间同步读取」升级为 `SettingsForms` 文档模型，事件与读取 API 均发生变化。插件 `0.2.0` 使用的旧接口在 DSH `0.2.x` 下已不可用，语言偏好在 `/deepseek-billing` 命令上的本地化会静默失效并回退中性文案。

## 2. 契约变化

| 旧（DSH `0.1.5-rc.2`） | 新（DSH `0.2.x`） |
|---|---|
| `settings.get('locale')` 返回命名空间对象 | `settings.describe()` 返回每个 profile 条目一个描述符（`{ ns, value, ... }`）的数组，`value` 为该命名空间文档 |
| `settings/updated (namespace, value, doc, op)` | `settings/document-updated (ns, revision)` |

其余被依赖面（credentials、Connection Fetch route、commands、session-controller、各 client ui 服务）在 `0.2.x` 内保持兼容，peer 范围整体平移即可。

## 3. 实施内容

### 3.1 宿主端读取（lib/index.js）

`readCommandMessages(ctx)` 改为：

- `settings` 服务缺失或 `describe` 不是函数 → 返回 `null`（中性文案）；
- `describe()` 返回非数组 → 返回 `null`；
- 在描述符数组中查找 `ns === 'locale'` 的条目，读取 `value?.preference`，未知语言仍走 `COMMAND_MESSAGES[preference] ?? null`；
- 整体保持 try/catch 包裹，读取失败不阻断余额查询。

命令重注册监听从 `settings/updated` 改为 `settings/document-updated`，仍按 `ns !== 'locale'` 过滤并在描述变化时注销/重注册命令，卸载清理逻辑不变。

### 3.2 包与元数据（package.json）

- 版本 `0.2.0` → `0.3.0`；
- 全部 11 个 `@deepseek-ai/dsh-*` peer 从 `>=0.1.5-rc.2 <0.1.6` 平移到 `>=0.2.0-rc.0 <0.3.0`。

### 3.3 测试（test/）

- `test/index.test.js`：settings 桩改为 `describe()` 数组形状；`updateLocalePreference` 触发 `settings/document-updated (ns, revision)`；新增 `settingsOverride` 参数并补充防御分支断言（`describe` 返回非数组、settings 无 `describe` 方法、条目缺 `ns`/`value`，均回退默认英文描述与中性文案）。
- `test/package.test.js`：`DSH_PEER_RANGE` 与版本断言更新为 `0.3.0` / `>=0.2.0-rc.0 <0.3.0`。

### 3.4 文档

中英文 README、`packaging.md`、`verification.md`、`limitations.md`、`host.md` 同步新版本号、peer 范围与 SettingsForms API 描述；`verification.md` 的真实装配命令改用 `@deepseek-ai/dsh@0.2.0-rc.2`。

## 4. 验收

- `node --test` 38/38 通过；`node --check lib/index.js`、`node --check lib/client.js` 通过；`package.json` 解析通过。
- 真实装配与浏览器手动复核按 [verification.md](verification.md) 的 DSH `0.2.0-rc.2` 清单执行，使用隔离 `DSH_HOME` 与受控 loopback mock，不使用真实生产凭据。

## 5. 非目标

- 不在本轮放宽到 DSH `0.3.0+`；`0.3.0` 的契约变化未核对。
- 不改变余额服务、HTTP 路由、错误码与客户端行为。
