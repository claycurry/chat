# @chat-adapter/telegram

[![npm version](https://img.shields.io/npm/v/@chat-adapter/telegram)](https://www.npmjs.com/package/@chat-adapter/telegram)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/telegram)](https://www.npmjs.com/package/@chat-adapter/telegram)

Telegram adapter for [Chat SDK](https://chat-sdk.dev/docs).

## Installation

```bash
npm install chat @chat-adapter/telegram
```

## Usage

```typescript
import { Chat } from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    telegram: createTelegramAdapter({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
    }),
  },
});
```

Features include mentions, reactions, typing indicators, file uploads, and card fallback rendering with inline keyboard buttons for card actions.

## Polling mode

Use long polling (`getUpdates`) when you cannot expose a public webhook endpoint.
Polling starts automatically when `polling` is provided. Pass `polling: true` to use defaults.

```typescript
import { createMemoryState } from "@chat-adapter/state-memory";

const telegram = createTelegramAdapter({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  mode: "polling",
  polling: {
    timeout: 30,
    dropPendingUpdates: false,
  },
});

const bot = new Chat({
  userName: "mybot",
  adapters: { telegram },
  state: createMemoryState(),
});

// Optional manual control
await telegram.startPolling();
await telegram.stopPolling();
```

### Auto mode (local polling + production webhooks)

```typescript
const telegram = createTelegramAdapter({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  mode: "auto", // default
  polling: { timeout: 30 }, // used only when auto mode selects polling
});

const bot = new Chat({
  userName: "mybot",
  adapters: { telegram },
  state: createMemoryState(),
});

// Required for long-running local processes without incoming webhooks:
void bot.initialize();
```

## Documentation

Full setup instructions, configuration reference, and features at [chat-sdk.dev/docs/adapters/telegram](https://chat-sdk.dev/docs/adapters/telegram).

## License

MIT
