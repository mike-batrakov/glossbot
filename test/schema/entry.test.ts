import { describe, expect, it } from "vitest";
import {
  SEVERITIES,
  createEntry,
  createMetadataLine,
  generateId,
  isHttpError,
  isValidSeverity,
  type GlossEntry,
  type GlossMetadata,
} from "../../src/schema/entry";

describe("generateId", () => {
  it("returns a string starting with g_", () => {
    const id = generateId();
    expect(id).toMatch(/^g_[0-9a-f]{8}$/);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe("isValidSeverity", () => {
  it("accepts valid severities", () => {
    expect(SEVERITIES).toEqual(["critical", "high", "medium", "low"]);
    expect(isValidSeverity("critical")).toBe(true);
    expect(isValidSeverity("high")).toBe(true);
    expect(isValidSeverity("medium")).toBe(true);
    expect(isValidSeverity("low")).toBe(true);
  });

  it("rejects invalid severities", () => {
    expect(isValidSeverity("hihg")).toBe(false);
    expect(isValidSeverity("CRITICAL")).toBe(false);
    expect(isValidSeverity("")).toBe(false);
  });
});

describe("createMetadataLine", () => {
  it("creates a valid metadata JSON string", () => {
    const line = createMetadataLine("owner/repo");
    const parsed = JSON.parse(line) as GlossMetadata;

    expect(parsed._type).toBe("glosslog");
    expect(parsed.version).toBe(1);
    expect(parsed.repo).toBe("owner/repo");
    expect(parsed.initialized_at).toBeDefined();
  });
});

describe("createEntry", () => {
  it("creates a structured entry with all fields", () => {
    const entry = createEntry({
      type: "structured",
      repo: "owner/repo",
      suggestion: {
        body: "Use a Map instead",
        author: "coderabbitai[bot]",
        author_type: "bot",
        url: "https://github.com/owner/repo/pull/1#discussion_r123",
      },
      location: {
        path: "src/cache.ts",
        start_line: 10,
        end_line: 15,
        original_commit_sha: "abc123",
      },
      pr: {
        number: 1,
        title: "Add cache",
        url: "https://github.com/owner/repo/pull/1",
      },
      deferred_by: "mbatrakov",
      severity: "medium",
      tags: [],
      note: null,
    });

    expect(entry._type).toBe("entry");
    expect(entry.id).toMatch(/^g_[0-9a-f]{8}$/);
    expect(entry.version).toBe(1);
    expect(entry.type).toBe("structured");
    expect(entry.source).toBe("github-pr");
    expect(entry.status).toBe("open");
    expect(entry.created_at).toBeDefined();
  });

  it("creates a freeform entry with location null", () => {
    const entry = createEntry({
      type: "freeform",
      repo: "owner/repo",
      suggestion: {
        body: "Refactor auth module",
        author: "teammate",
        author_type: "human",
        url: "https://github.com/owner/repo/pull/1#issuecomment-456",
      },
      location: null,
      pr: {
        number: 1,
        title: "Auth changes",
        url: "https://github.com/owner/repo/pull/1",
      },
      deferred_by: "mbatrakov",
      severity: "high",
      tags: ["v2"],
      note: "not worth the risk before launch",
    });

    expect(entry.type).toBe("freeform");
    expect(entry.location).toBeNull();
    expect(entry.tags).toEqual(["v2"]);
    expect(entry.note).toBe("not worth the risk before launch");
  });

  it("serializes to valid JSON with no extra fields", () => {
    const entry = createEntry({
      type: "freeform",
      repo: "owner/repo",
      suggestion: {
        body: "Fix this",
        author: "dev",
        author_type: "human",
        url: "https://example.com",
      },
      location: null,
      pr: {
        number: 1,
        title: "PR",
        url: "https://example.com",
      },
      deferred_by: "dev",
      severity: "low",
      tags: [],
      note: null,
    });

    const json = JSON.stringify(entry);
    const parsed = JSON.parse(json) as GlossEntry;

    expect(parsed._type).toBe("entry");
    // Keep this strict so schema drift is caught immediately in tests.
    expect(Object.keys(parsed)).toHaveLength(15);
  });
});

describe("isHttpError", () => {
  it("detects values with a numeric status property", () => {
    expect(isHttpError({ status: 404 })).toBe(true);
    expect(isHttpError({ status: 500, message: "boom" })).toBe(true);
  });

  it("rejects values without a status property", () => {
    expect(isHttpError(null)).toBe(false);
    expect(isHttpError(new Error("boom"))).toBe(false);
    expect(isHttpError({ message: "boom" })).toBe(false);
  });
});
