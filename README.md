<h1 align="center">dsh-deepseek-billing</h1>

<p align="center">简体中文 · <a href="https://github.com/golitter/dsh-deepseek-billing/blob/main/docs/README.en.md">English</a></p>

## 功能概述

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Web 设置页中增加“计费 / Billing”页面，提供：

- DeepSeek API 可用余额、充值余额和赠送余额展示
- 手动刷新及加载、空数据、错误状态；刷新失败时保留最近一次成功余额和更新时间
- 中文、英文实时切换
- 明暗主题与窄屏适配
- API Key 通过 DSH 凭证库安全读取，不会发送到浏览器
- 对话内斜杠命令 `/deepseek-billing` 快速返回余额；新建空白会话保持当前页面并显示临时提示，提示在会话激活、1 分钟到期或切换离开时自动清除，空白阶段的查询记录不会在会话激活后重新出现

## 第一性原理

这个插件只解决一个最基本的问题：**在不暴露 API Key 的前提下，让用户可靠地看到 DeepSeek 账户的真实余额。**

因此，当前功能有意保持克制：宿主负责安全读取凭据并请求 DeepSeek 官方余额接口，客户端只展示接口返回的余额，并提供手动刷新和稳定的错误反馈。插件不实现消费历史、趋势图、用量预测、余额告警、自动充值或 API Key 管理等扩展能力；这些功能要么缺少可靠的数据来源，要么超出了“查询余额”这一核心职责。没有实现它们是基于第一性原理做出的范围选择，而不是用虚构数据填充界面。

## 安装与使用

1. 安装插件：

   ```bash
   dsh plugin --profile web add github:golitter/dsh-deepseek-billing
   ```

2. 在 `$DSH_HOME/.credentials.yaml` 中配置 DeepSeek API Key：

   ```yaml
   version: 1

   refs:
     DEEPSEEK_API_KEY: sk-xxxxxxxxxxxxxxxx
   ```

   DSH 启动时会迁移已存在的旧扁平凭据文档；新文档请直接使用 `version: 1` 和 `refs` 格式。POSIX 系统上应限制文件权限，例如 `chmod 600 "$DSH_HOME/.credentials.yaml"`；不要在文档、日志或截图中记录真实密钥。

3. 启动 DSH Web：

   ```bash
   dsh --profile web
   ```

4. 打开“设置 → 计费 / Billing”查看余额；点击“刷新 / Refresh”可重新获取。首次请求失败会显示完整错误状态；已有余额后的刷新失败会保留旧余额，并在页面中显示非阻塞提示。

   ![DeepSeek 计费插件中文界面](https://raw.githubusercontent.com/golitter/dsh-deepseek-billing/main/docs/image_zh.png)

   ![DeepSeek billing plugin English interface](https://raw.githubusercontent.com/golitter/dsh-deepseek-billing/main/docs/image_en.png)

5. 也可在对话中直接输入无参数命令 `/deepseek-billing` 快速查看余额；在新建空白会话中，结果显示在输入框旁的临时提示中，不会进入对话记录页，并在会话激活、1 分钟到期或切换离开时自动清除；空白阶段执行过的余额命令不会在会话激活后重新显示为历史卡片。宿主已保存 `zh`/`en` 偏好时，斜杠菜单说明、标签、空态、错误和用法提示跟随语言并在切换后更新；远程浏览器仅有进程内语言或偏好不可用时，菜单说明回退英文，结果回退为不带标签的「币种 + 金额」、固定英文用法提示及稳定错误码。

   ![使用 deepseek-billing 斜杠命令查询余额](https://raw.githubusercontent.com/golitter/dsh-deepseek-billing/main/docs/deepseek_billing_command_zh.png)

## 配置与安全

详见 [配置与安全](https://github.com/golitter/dsh-deepseek-billing/blob/main/docs/design/configuration-and-security.md)。其中 `timeoutMs` 必须为大于 `0` 且不超过 `120000` 毫秒的有限数值，避免 Node.js 定时器溢出；设置页的等待超时会自动对齐该值（响应中附带 `timeoutMs`，客户端按其加余量对齐）。

当前发布线为 `0.2.0`，支持 DSH `>=0.1.5-rc.2 <0.1.6`。余额路由通过 DSH Connection 的 Fetch 注册，继承 DSH 的 Host/Origin 信任检查和浏览器 Cookie 认证；认证由 DSH 启动 URL 完成，插件不会自行实现或记录 Cookie。`0.1.6-alpha` 尚未纳入支持范围。
