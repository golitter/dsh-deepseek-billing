# 已知限制与后续

> 对应原设计文档 §11。访问控制边界的说明见 [security.md](security.md)。

## 11. 已知限制与后续

- 只展示 `balance_infos[0]`，多币种账户只显示第一条。
- 币种和金额仅校验为非空字符串并设置长度上限，不验证 ISO 币种代码或十进制定点格式。
- 余额只在打开区块 / 手动刷新时拉取，不自动轮询。
- 币种以 ISO 代码（如 `CNY`）展示，未做符号美化。
- 斜杠命令只展示总余额，「充值/赠送」明细仍在设置页展示；`preference` 未显式设置或仅存在于远程浏览器进程时，宿主命令回退为语言中性文本/稳定错误码。
- 侧边栏 label 依赖设置面板外壳对 `locale` revision 的订阅（框架已保证），插件自身不在注册时固化文案。
- 当前自动化使用 Node.js `node:test` 与轻量 hook harness；真实 React DOM、浏览器主题/布局、screen-reader 结果和 DSH 完整装配仍需按 [verification.md](verification.md) 的隔离发布前清单手动复核，暂不把 Playwright/DSH CLI 加入 PR 必跑依赖。
- 路由未叠加会话鉴权（DSH WebServer 可按部署配置绑定非 loopback，但当前 Web 没有登录态）；仅复刻 DSH `/api` 的 browser-trust fence 并以空信任列表锁定 loopback。通过 LAN/远程地址打开 Web UI 时，普通页面可按部署配置工作，但余额请求有意返回 `403`；`--trusted-host` 不放开余额，详见 [security.md](security.md)。
