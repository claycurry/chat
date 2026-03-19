import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createXAdapter, XAdapter } from "./index";

const NOT_SUPPORTED_PATTERN = /not support/i;
const API_KEY_PATTERN = /apiKey/i;
const API_SECRET_PATTERN = /apiSecret/i;
const ACCESS_TOKEN_PATTERN = /accessToken/i;
const ACCESS_TOKEN_SECRET_PATTERN = /accessTokenSecret/i;

/**
 * Create a minimal XAdapter for testing.
 */
function createTestAdapter(): XAdapter {
  return new XAdapter({
    apiKey: "test-api-key",
    apiSecret: "test-api-secret",
    accessToken: "test-access-token",
    accessTokenSecret: "test-access-token-secret",
    userName: "test-bot",
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  });
}

// ---------------------------------------------------------------------------
// encodeThreadId
// ---------------------------------------------------------------------------

describe("encodeThreadId", () => {
  it("should encode a thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({
      conversationId: "conv-123",
      participantId: "user-456",
    });
    expect(result).toBe("x:conv-123:user-456");
  });

  it("should encode with different IDs", () => {
    const adapter = createTestAdapter();
    const result = adapter.encodeThreadId({
      conversationId: "abc-def",
      participantId: "789",
    });
    expect(result).toBe("x:abc-def:789");
  });
});

// ---------------------------------------------------------------------------
// decodeThreadId
// ---------------------------------------------------------------------------

describe("decodeThreadId", () => {
  it("should decode a valid thread ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.decodeThreadId("x:conv-123:user-456");
    expect(result).toEqual({
      conversationId: "conv-123",
      participantId: "user-456",
    });
  });

  it("should throw on invalid prefix", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("slack:C123:ts123")).toThrow(
      "Invalid X thread ID"
    );
  });

  it("should throw on empty after prefix", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("x:")).toThrow(
      "Invalid X thread ID format"
    );
  });

  it("should throw on missing participantId", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("x:conv-123:")).toThrow(
      "Invalid X thread ID format"
    );
  });

  it("should throw on completely wrong format", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("nonsense")).toThrow(
      "Invalid X thread ID"
    );
  });

  it("should throw on extra segments", () => {
    const adapter = createTestAdapter();
    expect(() => adapter.decodeThreadId("x:a:b:extra")).toThrow(
      "Invalid X thread ID format"
    );
  });
});

// ---------------------------------------------------------------------------
// encodeThreadId / decodeThreadId roundtrip
// ---------------------------------------------------------------------------

describe("encodeThreadId / decodeThreadId roundtrip", () => {
  it("should round-trip a thread ID", () => {
    const adapter = createTestAdapter();
    const original = {
      conversationId: "conv-123",
      participantId: "user-456",
    };
    const encoded = adapter.encodeThreadId(original);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(original);
  });

  it("should round-trip with numeric-style IDs", () => {
    const adapter = createTestAdapter();
    const original = {
      conversationId: "1234567890",
      participantId: "9876543210",
    };
    const encoded = adapter.encodeThreadId(original);
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// channelIdFromThreadId
// ---------------------------------------------------------------------------

describe("channelIdFromThreadId", () => {
  it("should return conversation-level ID", () => {
    const adapter = createTestAdapter();
    const result = adapter.channelIdFromThreadId("x:conv-123:user-456");
    expect(result).toBe("x:conv-123");
  });
});

// ---------------------------------------------------------------------------
// isDM
// ---------------------------------------------------------------------------

describe("isDM", () => {
  it("should always return true", () => {
    const adapter = createTestAdapter();
    expect(adapter.isDM("x:conv-123:user-456")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renderFormatted
// ---------------------------------------------------------------------------

describe("renderFormatted", () => {
  it("should render plain text from AST", () => {
    const adapter = createTestAdapter();
    const ast = {
      type: "root" as const,
      children: [
        {
          type: "paragraph" as const,
          children: [{ type: "text" as const, value: "Hello world" }],
        },
      ],
    };
    const result = adapter.renderFormatted(ast);
    expect(result).toContain("Hello world");
  });
});

// ---------------------------------------------------------------------------
// parseMessage
// ---------------------------------------------------------------------------

describe("parseMessage", () => {
  it("should parse a raw X DM message", () => {
    const adapter = createTestAdapter();
    const raw = {
      id: "event-123",
      text: "Hello from X!",
      sender_id: "user-456",
      created_timestamp: "1700000000000",
    };
    const message = adapter.parseMessage(raw);
    expect(message.id).toBe("event-123");
    expect(message.text).toBe("Hello from X!");
    expect(message.author.userId).toBe("user-456");
  });

  it("should set correct dateSent from millisecond timestamp", () => {
    const adapter = createTestAdapter();
    const raw = {
      id: "event-time",
      text: "test",
      sender_id: "user-456",
      created_timestamp: "1700000000000",
    };
    const message = adapter.parseMessage(raw);
    expect(message.metadata.dateSent.getTime()).toBe(1700000000000);
  });

  it("should have no attachments for text messages", () => {
    const adapter = createTestAdapter();
    const raw = {
      id: "event-txt",
      text: "Hello",
      sender_id: "user-456",
      created_timestamp: "1700000000000",
    };
    const message = adapter.parseMessage(raw);
    expect(message.attachments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// handleWebhook - CRC challenge
// ---------------------------------------------------------------------------

describe("handleWebhook - CRC challenge", () => {
  it("should respond to valid CRC challenge", async () => {
    const adapter = createTestAdapter();
    const url = "https://example.com/webhook?crc_token=test-token-123";
    const request = new Request(url, { method: "GET" });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    // Verify the response_token is a valid HMAC-SHA256 of the crc_token
    const expectedHmac = createHmac("sha256", "test-api-secret")
      .update("test-token-123")
      .digest("base64");
    expect(body.response_token).toBe(`sha256=${expectedHmac}`);
  });

  it("should return 400 when crc_token is missing", async () => {
    const adapter = createTestAdapter();
    const url = "https://example.com/webhook";
    const request = new Request(url, { method: "GET" });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// handleWebhook - POST signature verification
// ---------------------------------------------------------------------------

function makeSignature(body: string, secret = "test-api-secret"): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("base64")}`;
}

function makeWebhookPayload(overrides?: { hasMessages?: boolean }) {
  const hasMessages = overrides?.hasMessages ?? true;
  return {
    for_user_id: "bot-user-id",
    ...(hasMessages
      ? {
          direct_message_events: [
            {
              type: "message_create",
              id: "event-123",
              created_timestamp: "1700000000000",
              message_create: {
                sender_id: "user-456",
                target: { recipient_id: "bot-user-id" },
                message_data: { text: "Hello" },
              },
            },
          ],
        }
      : {}),
  };
}

describe("handleWebhook - POST signature verification", () => {
  it("valid signature returns 200", async () => {
    const adapter = createTestAdapter();
    const payload = makeWebhookPayload();
    const body = JSON.stringify(payload);
    const sig = makeSignature(body);
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-twitter-webhooks-signature": sig,
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("invalid signature returns 401", async () => {
    const adapter = createTestAdapter();
    const body = JSON.stringify(makeWebhookPayload());
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-twitter-webhooks-signature": "sha256=badsignature",
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("missing signature returns 401", async () => {
    const adapter = createTestAdapter();
    const body = JSON.stringify(makeWebhookPayload());
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("invalid JSON returns 400", async () => {
    const adapter = createTestAdapter();
    const body = "not-json";
    const sig = makeSignature(body);
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-twitter-webhooks-signature": sig,
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });

  it("payload without DM events returns 200", async () => {
    const adapter = createTestAdapter();
    const payload = makeWebhookPayload({ hasMessages: false });
    const body = JSON.stringify(payload);
    const sig = makeSignature(body);
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-twitter-webhooks-signature": sig,
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// handleWebhook - POST message processing
// ---------------------------------------------------------------------------

const mockChat = {
  processMessage: vi.fn(),
  processReaction: vi.fn(),
  processAction: vi.fn(),
  processModalSubmit: vi.fn(),
  processModalClose: vi.fn(),
  processSlashCommand: vi.fn(),
  processMemberJoinedChannel: vi.fn(),
  getState: vi.fn(),
  getUserName: () => "test-bot",
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
};

describe("handleWebhook - POST message processing", () => {
  it("DM event calls chat.processMessage with correct thread and message", async () => {
    vi.clearAllMocks();
    const adapter = createTestAdapter();
    await adapter.initialize(mockChat as never);

    const payload = makeWebhookPayload();
    const body = JSON.stringify(payload);
    const sig = makeSignature(body);
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-twitter-webhooks-signature": sig,
        "content-type": "application/json",
      },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
    expect(mockChat.processMessage).toHaveBeenCalledOnce();
    const [, , message] = mockChat.processMessage.mock.calls[0];
    expect(message.text).toBe("Hello");
  });
});

// ---------------------------------------------------------------------------
// editMessage
// ---------------------------------------------------------------------------

describe("editMessage", () => {
  it("throws 'not support' error", async () => {
    const adapter = createTestAdapter();
    await expect(
      adapter.editMessage("x:conv:user", "event-123", { text: "Updated" })
    ).rejects.toThrow(NOT_SUPPORTED_PATTERN);
  });
});

// ---------------------------------------------------------------------------
// startTyping
// ---------------------------------------------------------------------------

describe("startTyping", () => {
  it("is a no-op and does not throw", async () => {
    const adapter = createTestAdapter();
    await expect(adapter.startTyping("x:conv:user")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fetchMessages
// ---------------------------------------------------------------------------

describe("fetchMessages", () => {
  it("returns empty messages array", async () => {
    const adapter = createTestAdapter();
    const result = await adapter.fetchMessages("x:conv:user");
    expect(result).toEqual({ messages: [] });
  });
});

// ---------------------------------------------------------------------------
// fetchThread
// ---------------------------------------------------------------------------

describe("fetchThread", () => {
  it("returns correct ThreadInfo", async () => {
    const adapter = createTestAdapter();
    const info = await adapter.fetchThread("x:conv-123:user-456");
    expect(info.id).toBe("x:conv-123:user-456");
    expect(info.channelId).toBe("x:conv-123");
    expect(info.isDM).toBe(true);
    expect(info.metadata).toEqual({
      conversationId: "conv-123",
      participantId: "user-456",
    });
  });
});

// ---------------------------------------------------------------------------
// openDM
// ---------------------------------------------------------------------------

describe("openDM", () => {
  it("returns encoded thread ID for the given user", async () => {
    const adapter = createTestAdapter();
    const threadId = await adapter.openDM("user-789");
    expect(threadId).toBe("x:user-789:user-789");
  });
});

// ---------------------------------------------------------------------------
// createXAdapter factory
// ---------------------------------------------------------------------------

describe("createXAdapter", () => {
  it("throws when apiKey is missing", () => {
    expect(() =>
      createXAdapter({
        apiSecret: "secret",
        accessToken: "token",
        accessTokenSecret: "token-secret",
      })
    ).toThrow(API_KEY_PATTERN);
  });

  it("throws when apiSecret is missing", () => {
    expect(() =>
      createXAdapter({
        apiKey: "key",
        accessToken: "token",
        accessTokenSecret: "token-secret",
      })
    ).toThrow(API_SECRET_PATTERN);
  });

  it("throws when accessToken is missing", () => {
    expect(() =>
      createXAdapter({
        apiKey: "key",
        apiSecret: "secret",
        accessTokenSecret: "token-secret",
      })
    ).toThrow(ACCESS_TOKEN_PATTERN);
  });

  it("throws when accessTokenSecret is missing", () => {
    expect(() =>
      createXAdapter({
        apiKey: "key",
        apiSecret: "secret",
        accessToken: "token",
      })
    ).toThrow(ACCESS_TOKEN_SECRET_PATTERN);
  });

  it("uses environment variables as fallback", () => {
    const requiredEnvVars = {
      X_API_KEY: "env-key",
      X_API_SECRET: "env-secret",
      X_ACCESS_TOKEN: "env-token",
      X_ACCESS_TOKEN_SECRET: "env-token-secret",
    };
    const originalEnv = { ...process.env };
    for (const [key, value] of Object.entries(requiredEnvVars)) {
      process.env[key] = value;
    }

    try {
      const adapter = createXAdapter();
      expect(adapter).toBeInstanceOf(XAdapter);
    } finally {
      for (const key of Object.keys(requiredEnvVars)) {
        if (key in originalEnv) {
          process.env[key] = originalEnv[key];
        } else {
          delete process.env[key];
        }
      }
    }
  });
});
