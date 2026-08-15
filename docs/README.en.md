<h1 align="center">dsh-deepseek-billing</h1>

<p align="center"><a href="https://github.com/golitter/dsh-deepseek-billing/blob/main/README.md">简体中文</a> · English</p>

## Features

Adds a “Billing” page to the Web settings of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), providing:

- DeepSeek API available, topped-up, and granted balance display
- Manual refresh plus loading, empty, and error states
- Live switching between Chinese and English
- Light/dark theme and narrow-screen support
- Secure API Key access through the DSH credential store; the key is never sent to the browser
- A `/deepseek-billing` slash command for quickly checking the balance in a conversation; a new blank session stays on its current view and shows a transient notice, which is cleared when the session becomes active, after one minute, or when navigating away, and balance queries made while blank do not reappear after activation

## First Principles

This plugin solves one fundamental problem: **reliably showing the real DeepSeek account balance without exposing the API Key.**

The feature set is intentionally focused. The Host securely reads the credential and calls DeepSeek's official balance endpoint, while the Client only displays the returned balance, supports manual refresh, and presents stable error feedback. The plugin does not implement usage history, trend charts, consumption forecasts, balance alerts, automatic top-ups, or API Key management. Those features either lack a reliable data source or fall outside the core responsibility of querying the balance. Omitting them is a deliberate first-principles scope decision, rather than filling the interface with fabricated data.

## Installation and Usage

1. Install the plugin:

   ```bash
   dsh plugin --profile web add github:golitter/dsh-deepseek-billing
   ```

2. Configure the DeepSeek API Key in `$DSH_HOME/.credentials.yaml`:

   ```yaml
   DEEPSEEK_API_KEY: sk-xxxxxxxxxxxxxxxx
   ```

3. Start DSH Web:

   ```bash
   dsh --profile web
   ```

4. Open “Settings → Billing” to view the balance. Click “Refresh” to fetch it again.

   ![DeepSeek billing plugin Chinese interface](https://raw.githubusercontent.com/golitter/dsh-deepseek-billing/main/docs/image_zh.png)

   ![DeepSeek billing plugin English interface](https://raw.githubusercontent.com/golitter/dsh-deepseek-billing/main/docs/image_en.png)

5. You can also run the argument-free `/deepseek-billing` command in a conversation. In a new blank session, the result appears as a transient notice beside the input instead of entering the conversation history. The notice is cleared when the session becomes active, after one minute, or when navigating away; commands run while the session was blank do not later appear as history cards. When the Host has a saved `zh` or `en` preference, the slash-menu description, labels, empty state, errors, and usage message follow that language and update after it changes. If a remote browser only has an in-process language setting, or the Host preference is unavailable, the menu description falls back to English and results fall back to an unlabeled “currency + amount”, a fixed English usage message, or a stable error code.

   ![Querying the balance with the deepseek-billing slash command](https://raw.githubusercontent.com/golitter/dsh-deepseek-billing/main/docs/deepseek_billing_command_zh.png)

## Configuration and Security

See [Configuration and Security](https://github.com/golitter/dsh-deepseek-billing/blob/main/docs/design/configuration-and-security.md).
