# 目录结构

> 对应原设计文档 §12。设计文档索引见 [README.md](README.md)。

## 12. 目录结构

```text
.
├── package.json        # 包名、exports、dsh.bundle / dsh.client 声明、peerDependencies
├── cordis.patch.yml    # bundle patch：按包名插入宿主插件（id: deepseek-billing）
├── lib/
│   ├── index.js        # 宿主半：服务 + 路由 + 斜杠命令 + 错误码
│   └── client.js       # 客户端半：设置页 UI + 词典 + 命令临时提示（window.__ModuleLoader__.load）
├── docs/
│   ├── image_zh.png    # 中文界面截图
│   ├── image_en.png    # 英文界面截图
│   ├── deepseek_billing_command_zh.png  # 斜杠命令中文截图
│   └── design/         # 设计文档（本目录）
│       ├── README.md   # 文档索引与阅读顺序
│       ├── overview.md # 概述、设计目标与非目标、整体架构
│       ├── packaging.md
│       ├── host.md
│       ├── client.md
│       ├── i18n.md
│       ├── decisions.md
│       ├── security.md
│       ├── configuration-and-security.md
│       ├── verification.md
│       ├── limitations.md
│       └── structure.md
├── test/
│   ├── index.test.js   # 宿主端服务、错误码、路由、命令与配置测试
│   └── client.test.js  # 客户端模块、注入与国际化契约测试
├── AGENTS.md           # 代码代理约束
└── README.md           # 安装、使用与详细文档入口
```
