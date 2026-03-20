import {
  createDiscordAdapter,
  type DiscordAdapter,
} from "@chat-adapter/discord";
import {
  createGoogleChatAdapter,
  type GoogleChatAdapter,
} from "@chat-adapter/gchat";
import { createGitHubAdapter, type GitHubAdapter } from "@chat-adapter/github";
import { createLinearAdapter, type LinearAdapter } from "@chat-adapter/linear";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-adapter/teams";
import {
  createTelegramAdapter,
  type TelegramAdapter,
} from "@chat-adapter/telegram";
import {
  createWhatsAppAdapter,
  type WhatsAppAdapter,
} from "@chat-adapter/whatsapp";
import { ConsoleLogger } from "chat";
import { recorder, withRecording } from "./recorder";

// Create a shared logger for adapters that need explicit logger overrides
const logger = new ConsoleLogger("debug");

export interface Adapters {
  discord?: DiscordAdapter;
  gchat?: GoogleChatAdapter;
  github?: GitHubAdapter;
  linear?: LinearAdapter;
  slack?: SlackAdapter;
  teams?: TeamsAdapter;
  telegram?: TelegramAdapter;
  whatsapp?: WhatsAppAdapter;
}

// Methods to record for each adapter (outgoing API calls)
const DISCORD_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "startTyping",
  "openDM",
  "fetchMessages",
];
const SLACK_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "startTyping",
  "stream",
  "openDM",
  "fetchMessages",
];
const TEAMS_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "startTyping",
  "openDM",
  "fetchMessages",
];
const GCHAT_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "openDM",
  "fetchMessages",
];
const GITHUB_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "fetchMessages",
];
const LINEAR_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "fetchMessages",
];
const TELEGRAM_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "startTyping",
  "openDM",
  "fetchMessages",
];
const WHATSAPP_METHODS = [
  "postMessage",
  "editMessage",
  "deleteMessage",
  "addReaction",
  "removeReaction",
  "startTyping",
  "openDM",
  "fetchMessages",
];

/**
 * Build type-safe adapters based on available environment variables.
 * Adapters are only created if their required env vars are present.
 *
 * Factory functions auto-detect env vars, so only app-specific overrides
 * (like userName and appType) need to be provided explicitly.
 */
export function buildAdapters(): Adapters {
  // Start fetch recording to capture outgoing adapter API calls
  recorder.startFetchRecording();

  const adapters: Adapters = {};

  // Discord adapter (optional) - env vars: DISCORD_BOT_TOKEN, DISCORD_PUBLIC_KEY, DISCORD_APPLICATION_ID
  if (process.env.DISCORD_BOT_TOKEN) {
    adapters.discord = withRecording(
      createDiscordAdapter({
        userName: "Chat SDK Bot",
        logger: logger.child("discord"),
      }),
      "discord",
      DISCORD_METHODS
    );
  }

  // Slack adapter (optional) - env vars: SLACK_SIGNING_SECRET + (SLACK_BOT_TOKEN or SLACK_CLIENT_ID/SECRET)
  if (process.env.SLACK_SIGNING_SECRET) {
    adapters.slack = withRecording(
      createSlackAdapter({
        userName: "Chat SDK Bot",
        logger: logger.child("slack"),
        botToken: process.env.SLACK_BOT_TOKEN,
        clientSecret: process.env.SLACK_CLIENT_SECRET,
      }),
      "slack",
      SLACK_METHODS
    );
  }

  // Teams adapter (optional) - env vars: TEAMS_APP_ID, TEAMS_APP_PASSWORD
  if (process.env.TEAMS_APP_ID) {
    adapters.teams = withRecording(
      createTeamsAdapter({
        appType: "SingleTenant",
        userName: "Chat SDK Demo",
        logger: logger.child("teams"),
      }),
      "teams",
      TEAMS_METHODS
    );
  }

  // Google Chat adapter (optional) - env vars: GOOGLE_CHAT_CREDENTIALS or GOOGLE_CHAT_USE_ADC
  if (
    process.env.GOOGLE_CHAT_CREDENTIALS ||
    process.env.GOOGLE_CHAT_USE_ADC === "true"
  ) {
    try {
      adapters.gchat = withRecording(
        createGoogleChatAdapter({
          userName: "Chat SDK Demo",
          logger: logger.child("gchat"),
        }),
        "gchat",
        GCHAT_METHODS
      );
    } catch {
      console.warn(
        "[chat] Failed to create gchat adapter (check GOOGLE_CHAT_CREDENTIALS or GOOGLE_CHAT_USE_ADC)"
      );
    }
  }

  // GitHub adapter (optional) - env vars: GITHUB_WEBHOOK_SECRET + (GITHUB_TOKEN or GITHUB_APP_ID/PRIVATE_KEY)
  console.log("[chat] GitHub env check:", {
    hasWebhookSecret: !!process.env.GITHUB_WEBHOOK_SECRET,
    hasToken: !!process.env.GITHUB_TOKEN,
    hasAppId: !!process.env.GITHUB_APP_ID,
    hasPrivateKey: !!process.env.GITHUB_PRIVATE_KEY,
    hasInstallationId: !!process.env.GITHUB_INSTALLATION_ID,
  });
  if (process.env.GITHUB_WEBHOOK_SECRET) {
    try {
      console.log("[chat] Creating GitHub adapter...");
      adapters.github = withRecording(
        createGitHubAdapter({
          logger: logger.child("github"),
          userName: "chat-sdk-bot",
        }),
        "github",
        GITHUB_METHODS
      );
      console.log("[chat] GitHub adapter created successfully");
    } catch (err) {
      console.warn(
        "[chat] Failed to create github adapter:",
        err instanceof Error ? err.message : err
      );
    }
  }


  // WhatsApp adapter (optional) - env vars: WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN
  
  return adapters;
}
