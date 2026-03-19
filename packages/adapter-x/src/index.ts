import { createHmac } from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
import type {
  Adapter,
  AdapterPostableMessage,
  Author,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  RawMessage,
  StreamChunk,
  StreamOptions,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import { ConsoleLogger, Message } from "chat";
import { XFormatConverter } from "./markdown";
import type {
  XAdapterConfig,
  XDirectMessageEvent,
  XRawMessage,
  XThreadId,
  XWebhookPayload,
} from "./types";

// Re-export types
export type { XAdapterConfig, XRawMessage, XThreadId } from "./types";

/**
 * X (Twitter) adapter for chat SDK.
 *
 * Supports messaging via the X API v2 Direct Messages.
 * All conversations are DMs between the bot and users.
 *
 * @example
 * ```typescript
 * import { Chat } from "chat";
 * import { createXAdapter } from "@chat-adapter/x";
 * import { MemoryState } from "@chat-adapter/state-memory";
 *
 * const chat = new Chat({
 *   userName: "my-bot",
 *   adapters: {
 *     x: createXAdapter(),
 *   },
 *   state: new MemoryState(),
 * });
 * ```
 */
export class XAdapter implements Adapter<XThreadId, XRawMessage> {
  readonly name = "x";
  readonly persistMessageHistory = true;
  readonly userName: string;

  private readonly apiKey: string;
  private readonly apiSecret: string;
  private chat: ChatInstance | null = null;
  private readonly logger: Logger;
  private readonly _botUserId: string | null = null;
  private readonly formatConverter = new XFormatConverter();

  /** Bot user ID used for self-message detection */
  get botUserId(): string | undefined {
    return this._botUserId ?? undefined;
  }

  constructor(config: XAdapterConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.logger = config.logger;
    this.userName = config.userName;
  }

  /**
   * Initialize the adapter.
   */
  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger.info("X adapter initialized", {
      userName: this.userName,
    });
  }

  /**
   * Handle incoming webhook from X Account Activity API.
   *
   * Handles both GET CRC token validation and POST event notifications.
   *
   * @see https://developer.x.com/en/docs/twitter-api/enterprise/account-activity-api
   */
  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    // Handle CRC token validation (GET request)
    if (request.method === "GET") {
      return this.handleCrcChallenge(request);
    }

    const body = await request.text();

    // Verify request signature (x-twitter-webhooks-signature header)
    const signature = request.headers.get("x-twitter-webhooks-signature");
    if (!this.verifySignature(body, signature)) {
      return new Response("Invalid signature", { status: 401 });
    }

    // Parse the JSON payload
    let payload: XWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      this.logger.error("X webhook invalid JSON", {
        contentType: request.headers.get("content-type"),
        bodyPreview: body.substring(0, 200),
      });
      return new Response("Invalid JSON", { status: 400 });
    }

    // Process DM events
    if (payload.direct_message_events) {
      for (const event of payload.direct_message_events) {
        if (event.type === "message_create") {
          try {
            this.handleDmEvent(event, options);
          } catch (error) {
            this.logger.error("Failed to handle DM event", {
              eventId: event.id,
              error,
            });
          }
        }
      }
    }

    return new Response("ok", { status: 200 });
  }

  /**
   * Handle CRC token challenge from X Account Activity API.
   *
   * X sends a GET request with a crc_token query parameter.
   * We must respond with a JSON object containing the HMAC-SHA256
   * hash of the token using our API secret.
   *
   * @see https://developer.x.com/en/docs/twitter-api/enterprise/account-activity-api/guides/securing-webhooks
   */
  private handleCrcChallenge(request: Request): Response {
    const url = new URL(request.url);
    const crcToken = url.searchParams.get("crc_token");

    if (!crcToken) {
      return new Response("Missing crc_token", { status: 400 });
    }

    const hmac = createHmac("sha256", this.apiSecret)
      .update(crcToken)
      .digest("base64");

    return new Response(JSON.stringify({ response_token: `sha256=${hmac}` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Verify webhook signature using HMAC-SHA256 with the API secret.
   */
  private verifySignature(body: string, signature: string | null): boolean {
    if (!signature) {
      return false;
    }

    const expectedSignature = `sha256=${createHmac("sha256", this.apiSecret).update(body).digest("base64")}`;

    try {
      return signature === expectedSignature;
    } catch {
      return false;
    }
  }

  /**
   * Handle an incoming DM event.
   */
  private handleDmEvent(
    event: XDirectMessageEvent,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring DM event");
      return;
    }

    // Skip messages from self
    if (event.message_create.sender_id === this._botUserId) {
      return;
    }

    const senderId = event.message_create.sender_id;
    const recipientId = event.message_create.target.recipient_id;
    const conversationId = [senderId, recipientId].sort().join("-");

    const threadId = this.encodeThreadId({
      conversationId,
      participantId: senderId,
    });

    const text = event.message_create.message_data.text;

    const raw: XRawMessage = {
      id: event.id,
      text,
      sender_id: senderId,
      created_timestamp: event.created_timestamp,
    };

    const author: Author = {
      userId: senderId,
      userName: senderId,
      fullName: senderId,
      isBot: false,
      isMe: false,
    };

    const formatted: FormattedContent = this.formatConverter.toAst(text);

    const message = new Message<XRawMessage>({
      id: event.id,
      threadId,
      text,
      formatted,
      raw,
      author,
      metadata: {
        dateSent: new Date(Number.parseInt(event.created_timestamp, 10)),
        edited: false,
      },
      attachments: [],
    });

    this.chat.processMessage(this, threadId, message, options);
  }

  /**
   * Send a DM via X API v2.
   */
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<XRawMessage>> {
    const { participantId } = this.decodeThreadId(threadId);
    const body = this.formatConverter.renderPostable(message);

    // Stub: would call X API v2 DM endpoint
    throw new Error(
      `Not implemented: would send DM to ${participantId} with text: ${body.substring(0, 100)}`
    );
  }

  /**
   * Edit a message. X does not support editing DMs.
   */
  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage<XRawMessage>> {
    throw new Error("X does not support editing direct messages.");
  }

  /**
   * Delete a DM.
   */
  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new Error("Not implemented: X DM deletion");
  }

  /**
   * Parse platform message format to normalized format.
   */
  parseMessage(raw: XRawMessage): Message<XRawMessage> {
    const text = raw.text;
    const formatted: FormattedContent = this.formatConverter.toAst(text);

    const conversationId = raw.sender_id;
    const threadId = this.encodeThreadId({
      conversationId,
      participantId: raw.sender_id,
    });

    return new Message<XRawMessage>({
      id: raw.id,
      threadId,
      text,
      formatted,
      author: {
        userId: raw.sender_id,
        userName: raw.sender_id,
        fullName: raw.sender_id,
        isBot: false,
        isMe: raw.sender_id === this._botUserId,
      },
      metadata: {
        dateSent: new Date(Number.parseInt(raw.created_timestamp, 10)),
        edited: false,
      },
      attachments: [],
      raw,
    });
  }

  /**
   * Render formatted content to X-compatible plain text.
   */
  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  /**
   * Stream a message by buffering all chunks and sending as a single message.
   * X doesn't support message editing, so we can't do incremental updates.
   */
  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<XRawMessage>> {
    let accumulated = "";
    for await (const chunk of textStream) {
      if (typeof chunk === "string") {
        accumulated += chunk;
      } else if (chunk.type === "markdown_text") {
        accumulated += chunk.text;
      }
    }
    return this.postMessage(threadId, { markdown: accumulated });
  }

  /**
   * Fetch messages. X DM API has limited history access.
   */
  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions
  ): Promise<FetchResult<XRawMessage>> {
    this.logger.debug("fetchMessages not yet implemented for X adapter");
    return { messages: [] };
  }

  /**
   * Fetch thread info.
   */
  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { conversationId, participantId } = this.decodeThreadId(threadId);

    return {
      id: threadId,
      channelId: `x:${conversationId}`,
      channelName: `X DM: ${participantId}`,
      isDM: true,
      metadata: { conversationId, participantId },
    };
  }

  /**
   * Encode an X thread ID.
   *
   * Format: x:{conversationId}:{participantId}
   */
  encodeThreadId(platformData: XThreadId): string {
    return `x:${platformData.conversationId}:${platformData.participantId}`;
  }

  /**
   * Decode an X thread ID.
   *
   * Format: x:{conversationId}:{participantId}
   */
  decodeThreadId(threadId: string): XThreadId {
    if (!threadId.startsWith("x:")) {
      throw new ValidationError("x", `Invalid X thread ID: ${threadId}`);
    }

    const withoutPrefix = threadId.slice(2);
    if (!withoutPrefix) {
      throw new ValidationError("x", `Invalid X thread ID format: ${threadId}`);
    }

    const parts = withoutPrefix.split(":");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new ValidationError("x", `Invalid X thread ID format: ${threadId}`);
    }

    return {
      conversationId: parts[0],
      participantId: parts[1],
    };
  }

  /**
   * Derive channel ID from an X thread ID.
   * Returns the conversation-level identifier.
   */
  channelIdFromThreadId(threadId: string): string {
    const { conversationId } = this.decodeThreadId(threadId);
    return `x:${conversationId}`;
  }

  /**
   * All X DM conversations are DMs.
   */
  isDM(_threadId: string): boolean {
    return true;
  }

  /**
   * Open a DM with a user.
   */
  async openDM(userId: string): Promise<string> {
    return this.encodeThreadId({
      conversationId: userId,
      participantId: userId,
    });
  }

  /**
   * Add a reaction to a DM.
   */
  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new Error("Not implemented: X DM reactions");
  }

  /**
   * Remove a reaction from a DM.
   */
  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new Error("Not implemented: X DM reaction removal");
  }

  /**
   * Start typing indicator.
   * X does not support typing indicators in DMs via API.
   */
  async startTyping(_threadId: string, _status?: string): Promise<void> {
    // No-op: X doesn't support typing indicators
  }
}

/**
 * Factory function to create an X adapter.
 *
 * @example
 * ```typescript
 * const adapter = createXAdapter({
 *   apiKey: process.env.X_API_KEY!,
 *   apiSecret: process.env.X_API_SECRET!,
 *   accessToken: process.env.X_ACCESS_TOKEN!,
 *   accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET!,
 * });
 * ```
 */
export function createXAdapter(config?: {
  accessToken?: string;
  accessTokenSecret?: string;
  apiKey?: string;
  apiSecret?: string;
  bearerToken?: string;
  logger?: Logger;
  userName?: string;
}): XAdapter {
  const logger = config?.logger ?? new ConsoleLogger("info").child("x");

  const apiKey = config?.apiKey ?? process.env.X_API_KEY;
  if (!apiKey) {
    throw new ValidationError(
      "x",
      "apiKey is required. Set X_API_KEY or provide it in config."
    );
  }

  const apiSecret = config?.apiSecret ?? process.env.X_API_SECRET;
  if (!apiSecret) {
    throw new ValidationError(
      "x",
      "apiSecret is required. Set X_API_SECRET or provide it in config."
    );
  }

  const accessToken = config?.accessToken ?? process.env.X_ACCESS_TOKEN;
  if (!accessToken) {
    throw new ValidationError(
      "x",
      "accessToken is required. Set X_ACCESS_TOKEN or provide it in config."
    );
  }

  const accessTokenSecret =
    config?.accessTokenSecret ?? process.env.X_ACCESS_TOKEN_SECRET;
  if (!accessTokenSecret) {
    throw new ValidationError(
      "x",
      "accessTokenSecret is required. Set X_ACCESS_TOKEN_SECRET or provide it in config."
    );
  }

  const userName = config?.userName ?? process.env.X_BOT_USERNAME ?? "x-bot";

  return new XAdapter({
    apiKey,
    apiSecret,
    accessToken,
    accessTokenSecret,
    bearerToken: config?.bearerToken ?? process.env.X_BEARER_TOKEN,
    userName,
    logger,
  });
}
