# 已知限制与后续

> 对应原设计文档 §11。访问控制边界的说明见 [security.md](security.md)。

## 11. 已知限制与后续

- 只展示 `balance_infos[0]`，多币种账户只显示第一条。
- 币种和金额仅校验为非空字符串并设置长度上限，不验证 ISO 币种代码或十进制定点格式。
- 余额只在打开区块 / 手动刷新时拉取，不自动轮询。
- 币种以 ISO 代码（如 `CNY`）展示，未做符号美化。
- 斜杠命令只展示总余额，「充值/赠送」明细仍在设置页展示；`preference` 未显式设置或仅存在于远程浏览器进程时，宿主命令回退为语言中性文本/稳定错误码。
- 侧边栏 label 依赖设置面板外壳对 `locale` revision 的订阅（框架已保证），插件自身不在注册时固化文案。
- 路由未叠加会话鉴权（DSH Web 为 loopback 单用户、无登录态），仅复刻 DSH `/api` 的 browser-trust fence 并以空信任列表锁定 loopback；`--trusted-host` 不放开余额，详见 [security.md](security.md)。
