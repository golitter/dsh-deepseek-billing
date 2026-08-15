<h1 align="center">dsh-deepseek-billing</h1>

## 功能概述

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Web 设置页中增加“计费 / Billing”页面，提供：

- DeepSeek API 可用余额、充值余额和赠送余额展示
- 手动刷新及加载、空数据、错误状态
- 中文、英文实时切换
- 明暗主题与窄屏适配
- API Key 通过 DSH 凭证库安全读取，不会发送到浏览器
- 对话内斜杠命令 `/deepseek-billing` 快速返回余额；发现菜单说明和命令文案在宿主已保存语言偏好时跟随中英文

![DeepSeek 计费插件中文界面](docs/image_zh.png)

![DeepSeek billing plugin English interface](docs/image_en.png)

## 安装与使用

1. 安装插件：

   ```bash
   dsh plugin --profile web add github:golitter/dsh-deepseek-billing
   ```

2. 在 `$DSH_HOME/.credentials.yaml` 中配置 DeepSeek API Key：

   ```yaml
   DEEPSEEK_API_KEY: sk-xxxxxxxxxxxxxxxx
   ```

3. 启动 DSH Web：

   ```bash
   dsh --profile web
   ```

4. 打开“设置 → 计费 / Billing”查看余额；点击“刷新 / Refresh”可重新获取。

5. 也可在对话中直接输入无参数命令 `/deepseek-billing` 快速查看余额（返回「可用余额标签 + 币种 + 金额」）。宿主已保存 `zh`/`en` 偏好时，斜杠菜单说明、标签、空态、错误和用法提示跟随语言并在切换后更新；远程浏览器仅有进程内语言或偏好不可用时，菜单说明回退英文，结果回退为不带标签的「币种 + 金额」、固定英文用法提示及稳定错误码。
