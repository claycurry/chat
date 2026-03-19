import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import { Chat } from "chat";
import { buildAdapters } from "./adapters";

const state = process.env.REDIS_URL
  ? createRedisState({
      url: process.env.REDIS_URL,
      keyPrefix: "chat-sdk-webhooks",
    })
  : createMemoryState();
const adapters = buildAdapters();

// @ts-expect-error Adapters type lacks string index signature
export const bot = new Chat<typeof adapters>({
  userName: process.env.BOT_USERNAME || "mybot",
  adapters,
  state,
  logger: "debug",
});

// Handle new @mentions of the bot
bot.onNewMention(async (thread, _message) => {
  await thread.post("Hello from ChatSDK!");
});
