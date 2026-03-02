import type { Logger } from "chat";
import { describe, expect, it, vi } from "vitest";
import { createPostgresState, PostgresStateAdapter } from "./index";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("PostgresStateAdapter", () => {
  it("should export createPostgresState function", () => {
    expect(typeof createPostgresState).toBe("function");
  });

  it("should create an adapter instance", () => {
    const adapter = createPostgresState({
      url: "postgres://postgres:postgres@localhost:5432/chat",
      logger: mockLogger,
    });
    expect(adapter).toBeInstanceOf(PostgresStateAdapter);
  });

  describe.skip("integration tests (require Postgres)", () => {
    it("should connect to Postgres", async () => {
      const adapter = createPostgresState({
        url:
          process.env.POSTGRES_URL ||
          "postgres://postgres:postgres@localhost:5432/chat",
        logger: mockLogger,
      });
      await adapter.connect();
      await adapter.disconnect();
    });
  });
});
