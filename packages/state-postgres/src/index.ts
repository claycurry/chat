import type { Lock, Logger, StateAdapter } from "chat";
import { ConsoleLogger } from "chat";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

const stateSubscriptions = pgTable(
  "chat_state_subscriptions",
  {
    keyPrefix: text("key_prefix").notNull(),
    threadId: text("thread_id").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.keyPrefix, table.threadId] }),
  })
);

const stateLocks = pgTable(
  "chat_state_locks",
  {
    keyPrefix: text("key_prefix").notNull(),
    threadId: text("thread_id").notNull(),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.keyPrefix, table.threadId] }),
  })
);

const stateCache = pgTable(
  "chat_state_cache",
  {
    keyPrefix: text("key_prefix").notNull(),
    cacheKey: text("cache_key").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.keyPrefix, table.cacheKey] }),
  })
);

export interface PostgresStateAdapterOptions {
  /** Key prefix for all rows (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
  /** Postgres connection URL */
  url: string;
}

export interface PostgresStateClientOptions {
  /** Existing postgres client instance */
  client: Sql;
  /** Key prefix for all rows (default: "chat-sdk") */
  keyPrefix?: string;
  /** Logger instance for error reporting */
  logger?: Logger;
}

export type CreatePostgresStateOptions =
  | (Partial<PostgresStateAdapterOptions> & { client?: never })
  | (Partial<Omit<PostgresStateClientOptions, "client">> & {
      client: Sql;
    });

/**
 * PostgreSQL state adapter for production use.
 *
 * Provides persistent subscriptions and distributed locking
 * across multiple server instances.
 */
export class PostgresStateAdapter implements StateAdapter {
  private readonly client: Sql;
  private readonly keyPrefix: string;
  private readonly logger: Logger;
  private readonly ownsClient: boolean;
  private readonly db;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(
    options: PostgresStateAdapterOptions | PostgresStateClientOptions
  ) {
    if ("client" in options) {
      this.client = options.client;
      this.ownsClient = false;
    } else {
      this.client = postgres(options.url);
      this.ownsClient = true;
    }

    this.db = drizzle(this.client);
    this.keyPrefix = options.keyPrefix || "chat-sdk";
    this.logger = options.logger ?? new ConsoleLogger("info").child("postgres");
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (!this.connectPromise) {
      this.connectPromise = (async () => {
        try {
          // Ensures the first connection is established.
          await this.client`select 1`;
          await this.ensureSchema();
          this.connected = true;
        } catch (error) {
          this.connectPromise = null;
          this.logger.error("Postgres connect failed", { error });
          throw error;
        }
      })();
    }

    await this.connectPromise;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    if (this.ownsClient) {
      await this.client.end();
    }

    this.connected = false;
    this.connectPromise = null;
  }

  async subscribe(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.db
      .insert(stateSubscriptions)
      .values({
        keyPrefix: this.keyPrefix,
        threadId,
      })
      .onConflictDoNothing();
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.ensureConnected();

    await this.db
      .delete(stateSubscriptions)
      .where(
        and(
          eq(stateSubscriptions.keyPrefix, this.keyPrefix),
          eq(stateSubscriptions.threadId, threadId)
        )
      );
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    this.ensureConnected();

    const row = await this.db
      .select({ threadId: stateSubscriptions.threadId })
      .from(stateSubscriptions)
      .where(
        and(
          eq(stateSubscriptions.keyPrefix, this.keyPrefix),
          eq(stateSubscriptions.threadId, threadId)
        )
      )
      .limit(1);

    return row.length > 0;
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    this.ensureConnected();

    const token = generateToken();
    const expiresAt = new Date(Date.now() + ttlMs);

    const row = await this.db
      .insert(stateLocks)
      .values({
        keyPrefix: this.keyPrefix,
        threadId,
        token,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [stateLocks.keyPrefix, stateLocks.threadId],
        set: {
          token: sql`excluded.token`,
          expiresAt: sql`excluded.expires_at`,
          updatedAt: sql`now()`,
        },
        // Only replace the existing row when the lock is expired.
        where: lte(stateLocks.expiresAt, sql`now()`),
      })
      .returning({
        threadId: stateLocks.threadId,
        token: stateLocks.token,
        expiresAt: stateLocks.expiresAt,
      });

    if (row.length === 0) {
      return null;
    }

    return {
      threadId: row[0].threadId,
      token: row[0].token,
      expiresAt: row[0].expiresAt.getTime(),
    };
  }

  async releaseLock(lock: Lock): Promise<void> {
    this.ensureConnected();

    await this.db
      .delete(stateLocks)
      .where(
        and(
          eq(stateLocks.keyPrefix, this.keyPrefix),
          eq(stateLocks.threadId, lock.threadId),
          eq(stateLocks.token, lock.token)
        )
      );
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    this.ensureConnected();

    const row = await this.db
      .update(stateLocks)
      .set({
        expiresAt: sql`(now() + ${ttlMs} * interval '1 millisecond')`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(stateLocks.keyPrefix, this.keyPrefix),
          eq(stateLocks.threadId, lock.threadId),
          eq(stateLocks.token, lock.token),
          gt(stateLocks.expiresAt, sql`now()`)
        )
      )
      .returning({ threadId: stateLocks.threadId });

    return row.length > 0;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureConnected();

    const row = await this.db
      .select({
        value: stateCache.value,
      })
      .from(stateCache)
      .where(
        and(
          eq(stateCache.keyPrefix, this.keyPrefix),
          eq(stateCache.cacheKey, key),
          or(isNull(stateCache.expiresAt), gt(stateCache.expiresAt, sql`now()`))
        )
      )
      .limit(1);

    if (row.length === 0) {
      // Opportunistic cleanup when the only matching row has expired.
      await this.db
        .delete(stateCache)
        .where(
          and(
            eq(stateCache.keyPrefix, this.keyPrefix),
            eq(stateCache.cacheKey, key),
            lte(stateCache.expiresAt, sql`now()`)
          )
        );

      return null;
    }

    try {
      return JSON.parse(row[0].value) as T;
    } catch {
      return row[0].value as unknown as T;
    }
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.ensureConnected();

    const serialized = JSON.stringify(value);
    const expiresAt = ttlMs ? new Date(Date.now() + ttlMs) : null;

    await this.db
      .insert(stateCache)
      .values({
        keyPrefix: this.keyPrefix,
        cacheKey: key,
        value: serialized,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [stateCache.keyPrefix, stateCache.cacheKey],
        set: {
          value: serialized,
          expiresAt,
          updatedAt: sql`now()`,
        },
      });
  }

  async delete(key: string): Promise<void> {
    this.ensureConnected();

    await this.db
      .delete(stateCache)
      .where(
        and(
          eq(stateCache.keyPrefix, this.keyPrefix),
          eq(stateCache.cacheKey, key)
        )
      );
  }

  /**
   * Get the underlying postgres client for advanced usage.
   */
  getClient(): Sql {
    return this.client;
  }

  private async ensureSchema(): Promise<void> {
    await this.client`
      create table if not exists chat_state_subscriptions (
        key_prefix text not null,
        thread_id text not null,
        created_at timestamptz not null default now(),
        primary key (key_prefix, thread_id)
      )
    `;
    await this.client`
      create table if not exists chat_state_locks (
        key_prefix text not null,
        thread_id text not null,
        token text not null,
        expires_at timestamptz not null,
        updated_at timestamptz not null default now(),
        primary key (key_prefix, thread_id)
      )
    `;
    await this.client`
      create table if not exists chat_state_cache (
        key_prefix text not null,
        cache_key text not null,
        value text not null,
        expires_at timestamptz,
        updated_at timestamptz not null default now(),
        primary key (key_prefix, cache_key)
      )
    `;
    await this.client`
      create index if not exists chat_state_locks_expires_idx
      on chat_state_locks (expires_at)
    `;
    await this.client`
      create index if not exists chat_state_cache_expires_idx
      on chat_state_cache (expires_at)
    `;
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(
        "PostgresStateAdapter is not connected. Call connect() first."
      );
    }
  }
}

function generateToken(): string {
  return `pg_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

export function createPostgresState(
  options: CreatePostgresStateOptions = {}
): PostgresStateAdapter {
  if ("client" in options && options.client) {
    return new PostgresStateAdapter({
      client: options.client,
      keyPrefix: options.keyPrefix,
      logger: options.logger,
    });
  }

  const url = options.url ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Postgres url is required. Set POSTGRES_URL or DATABASE_URL, or provide it in options."
    );
  }

  return new PostgresStateAdapter({
    url,
    keyPrefix: options.keyPrefix,
    logger: options.logger,
  });
}
