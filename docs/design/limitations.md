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
- 余额路由的认证依赖 DSH Connection 的 Host/Origin trust fence、启动 token 和签名 Cookie；认证前的 `401`/`403` 由 DSH 统一处理。插件当前只支持 DSH `>=0.1.5-rc.2 <0.1.6`，尚未适配 `0.1.6-alpha` 的 retain/release 多会话模型及其 notice 所有权缺口。
