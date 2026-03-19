/**
 * Type definitions for the X (Twitter) adapter.
 *
 * Based on the X API v2 Direct Messages endpoint.
 * @see https://developer.x.com/en/docs/twitter-api/direct-messages
 */

import type { Logger } from "chat";

// =============================================================================
// Configuration
// =============================================================================

/**
 * X adapter configuration.
 *
 * Requires API credentials for making API calls and verifying webhooks.
 *
 * @see https://developer.x.com/en/docs/twitter-api/getting-started/getting-access-to-the-twitter-api
 */
export interface XAdapterConfig {
  /** OAuth 1.0a access token */
  accessToken: string;
  /** OAuth 1.0a access token secret */
  accessTokenSecret: string;
  /** OAuth 1.0a consumer API key */
  apiKey: string;
  /** OAuth 1.0a consumer API secret */
  apiSecret: string;
  /** OAuth 2.0 Bearer token (optional, for app-only auth) */
  bearerToken?: string;
  /** Logger instance for error reporting */
  logger: Logger;
  /** Bot display name / username (without @) */
  userName: string;
}

// =============================================================================
// Thread ID
// =============================================================================

/**
 * Decoded thread ID for X.
 *
 * X DM conversations are identified by a conversation ID and
 * the participant (recipient) user ID.
 *
 * Format: x:{conversationId}:{participantId}
 */
export interface XThreadId {
  /** X DM conversation ID */
  conversationId: string;
  /** Recipient user ID */
  participantId: string;
}

// =============================================================================
// Webhook Payloads
// =============================================================================

/**
 * X Account Activity API webhook payload for DM events.
 *
 * @see https://developer.x.com/en/docs/twitter-api/enterprise/account-activity-api
 */
export interface XWebhookPayload {
  /** Array of DM event objects */
  direct_message_events?: XDirectMessageEvent[];
  /** The user ID of the account that owns the subscription */
  for_user_id: string;
}

/**
 * A single DM event from the Account Activity API.
 */
export interface XDirectMessageEvent {
  /** Unix timestamp in milliseconds */
  created_timestamp: string;
  /** Unique event ID */
  id: string;
  /** Message creation details */
  message_create: {
    /** Sender user ID */
    sender_id: string;
    /** Target recipient */
    target: {
      recipient_id: string;
    };
    /** Message data */
    message_data: {
      text: string;
      entities?: {
        urls?: Array<{
          url: string;
          expanded_url: string;
          display_url: string;
        }>;
        hashtags?: Array<{
          text: string;
        }>;
        user_mentions?: Array<{
          id_str: string;
          screen_name: string;
        }>;
      };
    };
  };
  /** Event type (e.g., "message_create") */
  type: "message_create";
}

// =============================================================================
// Raw Message Type
// =============================================================================

/**
 * Platform-specific raw message type for X.
 */
export interface XRawMessage {
  /** Unix timestamp in milliseconds as string */
  created_timestamp: string;
  /** Unique message/event ID */
  id: string;
  /** Sender user ID */
  sender_id: string;
  /** Message text content */
  text: string;
}
