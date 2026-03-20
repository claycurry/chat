import {
  createDiscordAdapter,
  type DiscordAdapter,
} from "@chat-adapter/discord";
import { createGitHubAdapter, type GitHubAdapter } from "@chat-adapter/github";
import { ConsoleLogger } from "chat";

// Create a shared logger for adapters that need explicit logger overrides
const logger = new ConsoleLogger("debug");

export interface Adapters {
  discord?: DiscordAdapter;
  github?: GitHubAdapter;
}

/**
 * Build type-safe adapters based on available environment variables.
 * Adapters are only created if their required env vars are present.
 *
 * Factory functions auto-detect env vars, so only app-specific overrides
 * (like userName and appType) need to be provided explicitly.
 */
export function buildAdapters(): Adapters {
  const adapters: Adapters = {};

  // Discord adapter (optional) - env vars: DISCORD_BOT_TOKEN, DISCORD_PUBLIC_KEY, DISCORD_APPLICATION_ID
  if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_PUBLIC_KEY) {
    adapters.discord = createDiscordAdapter({
      botToken: process.env.DISCORD_BOT_TOKEN,
      publicKey: process.env.DISCORD_PUBLIC_KEY,
      logger,
    });
    console.info("[chat] Discord adapter initialized")
  } else {
    console.warn("[chat] Discord adapter skipped: DISCORD_BOT_TOKEN or DISCORD_PUBLIC_KEY not set");
  }

  // GitHub adapter (optional) - env vars: GITHUB_TOKEN + (GITHUB_TOKEN or GITHUB_APP_ID/PRIVATE_KEY)
  if (process.env.GITHUB_TOKEN) {
    try {
      adapters.github = createGitHubAdapter({
              token: process.env.GITHUB_TOKEN!,
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
      logger,
      });

      console.info("[chat] GitHub adapter initialized")
    } catch {
      console.warn(
        "[chat] Failed to create github adapter (check GITHUB_TOKEN or GITHUB_APP_ID/PRIVATE_KEY)"
      );
    }
  } else {
    console.warn("[chat] GitHub adapter skipped: GITHUB_TOKEN not set");
  }
/*
  // Slack adapter (optional) - env vars: SLACK_SIGNING_SECRET + (SLACK_BOT_TOKEN or SLACK_CLIENT_ID/SECRET)
  if (process.env.SLACK_SIGNING_SECRET) {
    adapters.slack = createSlackAdapter({
      userName: "Chat SDK Bot",
      logger: logger.child("slack"),
      botToken: process.env.SLACK_BOT_TOKEN,
      clientSecret: process.env.SLACK_CLIENT_SECRET,
    });
  }

  // Teams adapter (optional) - env vars: TEAMS_APP_ID, TEAMS_APP_PASSWORD
  if (process.env.TEAMS_APP_ID) {
    adapters.teams = createTeamsAdapter({
      appType: "SingleTenant",
      userName: "Chat SDK Demo",
      logger: logger.child("teams"),
    });
  }

  // Google Chat adapter (optional) - env vars: GOOGLE_CHAT_CREDENTIALS or GOOGLE_CHAT_USE_ADC
  if (
    process.env.GOOGLE_CHAT_CREDENTIALS ||
    process.env.GOOGLE_CHAT_USE_ADC === "true"
  ) {
    try {
      adapters.gchat = createGoogleChatAdapter({
        userName: "Chat SDK Demo",
        logger: logger.child("gchat"),
      });
    } catch {
      console.warn(
        "[chat] Failed to create gchat adapter (check GOOGLE_CHAT_CREDENTIALS or GOOGLE_CHAT_USE_ADC)"
      );
    }
  }
*/
  

  return adapters;
}
