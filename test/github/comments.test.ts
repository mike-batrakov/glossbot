import { describe, expect, it } from "vitest";
import { formatReply, type ReplyInput } from "../../src/github/comments";

describe("formatReply", () => {
  it("formats structured entries with defaults", () => {
    const input: ReplyInput = {
      type: "structured",
      id: "g_a1b2c3d4",
      path: "src/cache.ts",
      startLine: 87,
      endLine: 87,
      severity: "medium",
      tags: [],
      deferredBy: "mbatrakov",
      prNumber: 42,
      invalidOverrides: [],
    };

    const reply = formatReply(input);

    expect(reply).toContain("Tracked `src/cache.ts:87` · g_a1b2c3d4");
    expect(reply).toContain("severity: medium · tags: none");
    expect(reply).toContain("Deferred by @mbatrakov on PR #42");
  });

  it("formats structured multi-line ranges", () => {
    const input: ReplyInput = {
      type: "structured",
      id: "g_a1b2c3d4",
      path: "src/cache.ts",
      startLine: 8,
      endLine: 12,
      severity: "medium",
      tags: [],
      deferredBy: "mbatrakov",
      prNumber: 42,
      invalidOverrides: [],
    };

    const reply = formatReply(input);

    expect(reply).toContain("Tracked `src/cache.ts:8-12` · g_a1b2c3d4");
  });

  it("formats freeform entries", () => {
    const input: ReplyInput = {
      type: "freeform",
      id: "g_e5f6g7h8",
      path: null,
      startLine: null,
      endLine: null,
      severity: "high",
      tags: [],
      deferredBy: "mbatrakov",
      prNumber: 42,
      invalidOverrides: [],
    };

    const reply = formatReply(input);
    expect(reply).toContain("Tracked (freeform) · g_e5f6g7h8");
  });

  it("formats tags inline", () => {
    const input: ReplyInput = {
      type: "structured",
      id: "g_a1b2c3d4",
      path: "src/cache.ts",
      startLine: 87,
      endLine: 87,
      severity: "high",
      tags: ["v2", "backlog"],
      deferredBy: "mbatrakov",
      prNumber: 42,
      invalidOverrides: [],
    };

    const reply = formatReply(input);
    expect(reply).toContain("severity: high · tags: `v2`, `backlog`");
  });

  it("renders user-supplied tags as inert code spans", () => {
    const input: ReplyInput = {
      type: "structured",
      id: "g_a1b2c3d4",
      path: "src/cache.ts",
      startLine: 87,
      endLine: 87,
      severity: "high",
      tags: ["@reviewers", "<script>", "has`tick"],
      deferredBy: "mbatrakov",
      prNumber: 42,
      invalidOverrides: [],
    };

    const reply = formatReply(input);

    expect(reply).toContain("tags: `@reviewers`, `<script>`, ``has`tick``");
  });

  it("includes typo nudges for invalid severity overrides", () => {
    const input: ReplyInput = {
      type: "structured",
      id: "g_a1b2c3d4",
      path: "src/cache.ts",
      startLine: 87,
      endLine: 87,
      severity: "medium",
      tags: [],
      deferredBy: "mbatrakov",
      prNumber: 42,
      invalidOverrides: [{ key: "severity", value: "hihg" }],
    };

    const reply = formatReply(input);

    expect(reply).toContain("Unrecognized: `severity:hihg`");
    expect(reply).toContain("did you mean `severity:high`");
  });

  it("flags invalid severity without suggestion when unrelated", () => {
    const input: ReplyInput = {
      type: "structured",
      id: "g_a1b2c3d4",
      path: "src/cache.ts",
      startLine: 87,
      endLine: 87,
      severity: "medium",
      tags: [],
      deferredBy: "mbatrakov",
      prNumber: 42,
      invalidOverrides: [{ key: "severity", value: "banana" }],
    };

    const reply = formatReply(input);

    expect(reply).toContain("Unrecognized: `severity:banana`");
    expect(reply).not.toContain("did you mean");
  });
});
