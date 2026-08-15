# dsh-deepseek-billing 设计文档

> 版本：对应 package.json `0.1.0`。本目录记录当前实现与设计取舍；运行契约以 `package.json`、`lib/index.js` 和 `lib/client.js` 为准。

本目录是设计文档的唯一入口，按主题拆分为以下文档：

| 文档 | 内容 |
|---|---|
| [overview.md](overview.md) | 概述、设计目标与非目标、整体架构与三条数据流 |
| [packaging.md](packaging.md) | 打包与分发模型：双端包声明、bundle patch、clientModules 发现、三类 inject |
| [host.md](host.md) | 宿主端设计（lib/index.js）：常量与错误码、余额服务、数据模型、HTTP 路由、斜杠命令 |
| [client.md](client.md) | 客户端设计（lib/client.js）：模块外壳、命令临时提示、命令行插槽（空白阶段命令隐藏）、状态机、请求生命周期、样式 |
| [i18n.md](i18n.md) | 国际化设计：locale 接入、词典键集、实时切换、时间格式 |
| [decisions.md](decisions.md) | 关键决策与权衡（12 条） |
| [security.md](security.md) | 安全与隐私：凭据、访问控制边界、日志脱敏 |
| [configuration-and-security.md](configuration-and-security.md) | 配置项说明、安全边界与本地代理示例 |
| [verification.md](verification.md) | 静态检查、自动测试、手动检查清单与验证约定 |
| [limitations.md](limitations.md) | 已知限制与后续方向 |
| [structure.md](structure.md) | 项目目录结构 |

建议阅读顺序：`overview.md` → `packaging.md` → `host.md` → `client.md` → `i18n.md` → `decisions.md` → `security.md` → `verification.md` → `limitations.md`；配置与安全（`configuration-and-security.md`）可随时查阅。
