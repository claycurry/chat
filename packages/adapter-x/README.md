# @chat-adapter/x

[![npm version](https://img.shields.io/npm/v/@chat-adapter/x)](https://www.npmjs.com/package/@chat-adapter/x)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/x)](https://www.npmjs.com/package/@chat-adapter/x)

X (Twitter) DM adapter for [Chat SDK](https://chat-sdk.dev), using the [X API v2](https://developer.x.com/en/docs/twitter-api/direct-messages).

> **Note:** This adapter is scaffolded but not yet fully implemented. The adapter interface is stubbed out — API integration is in progress.

## Installation

```bash
pnpm add @chat-adapter/x
```

## Usage

```typescript
import { Chat } from "chat";
import { createXAdapter } from "@chat-adapter/x";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    x: createXAdapter(),
  },
});

bot.onNewMention(async (thread, message) => {
  await thread.post("Hello from X!");
});
```

When using `createXAdapter()` without arguments, credentials are auto-detected from environment variables.

## X API setup

### 1. Create an X app

1. Go to [developer.x.com/en/portal/dashboard](https://developer.x.com/en/portal/dashboard)
2. Create a new project and app
3. Enable **Read and Write** permissions under **User authentication settings**
4. Note your **API Key**, **API Secret**, **Access Token**, and **Access Token Secret**

### 2. Configure webhooks (Account Activity API)

1. Apply for access to the [Account Activity API](https://developer.x.com/en/docs/twitter-api/enterprise/account-activity-api)
2. Register your webhook URL: `https://your-domain.com/api/webhooks/x`
3. The adapter handles CRC token validation automatically

### 3. Get credentials

From your X developer portal, copy:

- **API Key** as `X_API_KEY`
- **API Secret** as `X_API_SECRET`
- **Access Token** as `X_ACCESS_TOKEN`
- **Access Token Secret** as `X_ACCESS_TOKEN_SECRET`
- **Bearer Token** (optional) as `X_BEARER_TOKEN`

## Configuration

All options are auto-detected from environment variables when not provided. You can call `createXAdapter()` with no arguments if the env vars are set.

| Option | Required | Description |
|--------|----------|-------------|
| `apiKey` | No* | OAuth 1.0a consumer API key. Auto-detected from `X_API_KEY` |
| `apiSecret` | No* | OAuth 1.0a consumer API secret. Auto-detected from `X_API_SECRET` |
| `accessToken` | No* | OAuth 1.0a access token. Auto-detected from `X_ACCESS_TOKEN` |
| `accessTokenSecret` | No* | OAuth 1.0a access token secret. Auto-detected from `X_ACCESS_TOKEN_SECRET` |
| `bearerToken` | No | OAuth 2.0 bearer token. Auto-detected from `X_BEARER_TOKEN` |
| `userName` | No | Bot username. Auto-detected from `X_BOT_USERNAME` (defaults to `x-bot`) |
| `logger` | No | Logger instance (defaults to `ConsoleLogger("info")`) |

*Required at runtime — either via config or environment variable.

## Environment variables

```bash
X_API_KEY=...              # OAuth 1.0a consumer API key
X_API_SECRET=...           # OAuth 1.0a consumer API secret (used for webhook signature verification)
X_ACCESS_TOKEN=...         # OAuth 1.0a access token
X_ACCESS_TOKEN_SECRET=...  # OAuth 1.0a access token secret
X_BEARER_TOKEN=...         # Optional, OAuth 2.0 bearer token for app-only auth
X_BOT_USERNAME=...         # Optional, defaults to "x-bot"
```

## Webhook setup

X uses the Account Activity API with two webhook mechanisms:

1. **CRC validation** (GET) — X sends a `crc_token` query parameter; the adapter responds with an HMAC-SHA256 hash using your API secret.
2. **Event delivery** (POST) — incoming DM events, verified via `x-twitter-webhooks-signature` header.

```typescript
// Next.js App Router example
import { bot } from "@/lib/bot";

export async function GET(request: Request) {
  return bot.adapters.x.handleWebhook(request);
}

export async function POST(request: Request) {
  return bot.adapters.x.handleWebhook(request);
}
```

## Features

### Messaging

| Feature | Supported |
|---------|-----------|
| Post message | Stubbed (not yet implemented) |
| Edit message | No (X limitation) |
| Delete message | Stubbed (not yet implemented) |
| Streaming | Buffered (accumulates then sends) |

### Conversations

| Feature | Supported |
|---------|-----------|
| Reactions | Stubbed (not yet implemented) |
| Typing indicator | No (X limitation) |
| DMs | Yes |
| Open DM | Yes |

### Incoming message types

| Type | Supported |
|------|-----------|
| Text | Yes |
| Images | Not yet |
| Links | Not yet |

### Message history

| Feature | Supported |
|---------|-----------|
| Fetch messages | Not yet (X DM API has limited history access) |
| Fetch thread info | Yes |

## Thread ID format

```
x:{conversationId}:{participantId}
```

Example: `x:123456-789012:789012`

## Troubleshooting

### CRC validation failing

- Confirm `X_API_SECRET` is correct — it's used to compute the HMAC-SHA256 response
- Ensure your endpoint returns JSON with `response_token` for GET requests

### Messages not arriving

- Verify you have Account Activity API access and a registered webhook
- Check that `x-twitter-webhooks-signature` verification is passing
- Ensure your app has **Read and Write** permissions

### Authentication errors

- Double-check all four OAuth 1.0a credentials are correct
- Ensure your access token has DM permissions enabled

## License

MIT
