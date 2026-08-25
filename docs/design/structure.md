# 目录结构

> 对应原设计文档 §12。设计文档索引见 [README.md](README.md)。

## 12. 目录结构

```text
.
├── .github/
│   └── workflows/ci.yml # Node.js 22.19.x/24.x 测试、覆盖率、语法与打包边界
├── package.json        # 包名、exports、dsh.bundle / dsh.client 声明、peerDependencies
├── cordis.patch.yml    # bundle patch：按包名插入宿主插件（id: deepseek-billing）
├── lib/
│   ├── index.js        # 宿主半：服务 + 路由 + 斜杠命令 + 错误码
│   └── client.js       # 客户端半：设置页 UI + 词典 + 命令临时提示（window.__ModuleLoader__.load）
├── docs/
│   ├── README.en.md    # 英文安装、配置和使用说明
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
│   ├── index.test.js   # 宿主端服务、错误码、路由、命令与配置测试（29 cases）
│   ├── client.test.js  # 客户端模块、注入、国际化、命令行插槽与会话提示（3 cases）
│   ├── client-render.test.js # 余额页状态、响应校验、刷新、ARIA 与翻译行为（4 cases）
│   └── package.test.js # 发布元数据、peer 与发布文件边界契约
├── AGENTS.md           # 代码代理约束
└── README.md           # 安装、使用与详细文档入口
```
