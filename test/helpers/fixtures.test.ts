import { describe, expect, it } from "vitest";
import { cloneFixture, loadGlosslogFixture, loadPayloadFixture } from "./fixtures";

describe("fixture helpers", () => {
  it("loads payload fixtures as fresh clones", () => {
    const first = loadPayloadFixture<Record<string, unknown>>(
      "pull_request_review_comment.created",
    );
    const second = loadPayloadFixture<Record<string, unknown>>(
      "pull_request_review_comment.created",
    );

    (first.comment as Record<string, unknown>).id = 999;

    expect((second.comment as Record<string, unknown>).id).toBe(200);
  });

  it("loads glosslog fixtures as raw text", () => {
    expect(loadGlosslogFixture("metadata-only")).toBe(
      '{"_type":"glosslog","version":1}\n',
    );
  });

  it("deep clones arbitrary fixture values", () => {
    const value = {
      nested: {
        path: "src/cache.ts",
      },
    };

    const cloned = cloneFixture(value);
    cloned.nested.path = "src/auth.ts";

    expect(value.nested.path).toBe("src/cache.ts");
  });
});
