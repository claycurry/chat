/**
 * Replay tests for Channel abstraction.
 *
 * Tests channel-level operations (thread.channel, channel.messages,
 * channel.post, channel.fetchMetadata) using recorded webhook payloads.
 *
 * Fixtures are loaded from fixtures/replay/channel/
 */

import type { ActionEvent, Channel, Message } from "chat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import slackFixtures from "../fixtures/replay/channel/slack.json";
import {
  createSlackTestContext,
  expectValidAction,
  type SlackTestContext,
} from "./replay-test-utils";

describe("Replay Tests - Channel", () => {
  describe("Slack", () => {
    let ctx: SlackTestContext;
    let capturedAction: ActionEvent | null = null;

    beforeEach(() => {
      capturedAction = null;

      ctx = createSlackTestContext(
        {
          botName: slackFixtures.botName,
          botUserId: slackFixtures.botUserId,
        },
        {
          onMention: async (thread) => {
            await thread.subscribe();
            await thread.post("Welcome!");
          },
          onAction: async (event) => {
            capturedAction = event;
          },
        },
      );

      // Mock conversations.info for fetchMetadata
      ctx.mockClient.conversations.info.mockResolvedValue({
        ok: true,
        channel: {
          id: "C0A511MBCUW",
          name: "chat-sdk",
          is_im: false,
          num_members: 5,
          purpose: { value: "Chat SDK testing" },
          topic: { value: "Channel topic" },
        },
      });

      // Mock conversations.history for channel messages
      ctx.mockClient.conversations.history.mockResolvedValue({
        ok: true,
        messages: [
          {
            type: "message",
            user: "U03STHCA1JM",
            text: "<@U0A56JUFP9A> Hey",
            ts: "1771287144.743569",
            thread_ts: "1771287144.743569",
          },
          {
            type: "message",
            user: "U03STHCA1JM",
            text: "Bar2",
            ts: "1771287114.209979",
          },
          {
            type: "message",
            user: "U03STHCA1JM",
            text: "Foo2",
            ts: "1771287111.962609",
          },
        ],
        has_more: false,
      });

      // Mock users.info for user lookups
      ctx.mockClient.users.info.mockResolvedValue({
        ok: true,
        user: {
          name: "malte",
          real_name: "Malte Ubl",
          profile: { display_name: "Malte Ubl", real_name: "Malte Ubl" },
        },
      });
    });

    afterEach(async () => {
      await ctx.chat.shutdown();
    });

    it("should handle channel-post action and access thread.channel", async () => {
      // First subscribe via mention
      await ctx.sendWebhook(slackFixtures.mention);

      // Send channel-post action
      await ctx.sendSlackAction(slackFixtures.channel_post_action);

      expectValidAction(capturedAction, {
        actionId: "channel-post",
        userId: "U03STHCA1JM",
        userName: "malte",
        adapterName: "slack",
        channelId: "C0A511MBCUW",
        isDM: false,
      });
    });

    it("should derive correct channel ID from thread", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.channel_post_action);

      const channel = capturedAction?.thread.channel;
      expect(channel).toBeDefined();
      expect(channel?.id).toBe("slack:C0A511MBCUW");
    });

    it("should fetch channel metadata", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.channel_post_action);

      const channel = capturedAction?.thread.channel;
      expect(channel).toBeDefined();

      const info = await channel?.fetchMetadata();
      expect(info?.name).toBe("#chat-sdk");
      expect(info?.isDM).toBe(false);
      expect(info?.memberCount).toBe(5);
      expect(info?.metadata).toEqual({
        purpose: "Chat SDK testing",
        topic: "Channel topic",
      });

      // Name should be cached after fetchMetadata
      expect(channel?.name).toBe("#chat-sdk");
    });

    it("should iterate channel messages newest first", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.channel_post_action);

      const channel = capturedAction?.thread.channel as Channel;

      const messages: Message[] = [];
      for await (const msg of channel.messages) {
        messages.push(msg);
      }

      // Messages should be in reverse chronological order (newest first)
      expect(messages).toHaveLength(3);
      // Newest first (conversations.history returns newest-first, reversed to
      // chronological within page, then reversed again for backward iteration)
      expect(messages[0].text).toContain("Hey");
      expect(messages[1].text).toBe("Bar2");
      expect(messages[2].text).toBe("Foo2");

      // Verify fetchChannelMessages was called with backward direction
      expect(ctx.mockClient.conversations.history).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C0A511MBCUW",
        }),
      );
    });

    it("should post to channel top-level via channel.post", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.channel_post_action);

      const channel = capturedAction?.thread.channel as Channel;

      await channel.post("Hello from channel!");

      // Should call postMessage (via postChannelMessage which delegates to
      // postMessage with empty threadTs)
      expect(ctx.mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C0A511MBCUW",
          text: "Hello from channel!",
        }),
      );
    });

    it("should allow breaking out of channel.messages early", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.channel_post_action);

      const channel = capturedAction?.thread.channel as Channel;

      // Only get first 2 messages
      const messages: Message[] = [];
      for await (const msg of channel.messages) {
        messages.push(msg);
        if (messages.length >= 2) break;
      }

      expect(messages).toHaveLength(2);
    });

    it("should cache channel instance on thread", async () => {
      await ctx.sendWebhook(slackFixtures.mention);
      await ctx.sendSlackAction(slackFixtures.channel_post_action);

      const thread = capturedAction?.thread;
      const channel1 = thread?.channel;
      const channel2 = thread?.channel;
      expect(channel1).toBe(channel2);
    });
  });
});
