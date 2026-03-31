import { describe, expect, it, vi } from "vitest";
import { extractContext, inferSeverity } from "../../src/github/context";

describe("extractContext", () => {
  it("uses the parent review comment for structured review replies", async () => {
    const octokit = {
      rest: {
        pulls: {
          getReviewComment: vi.fn().mockResolvedValue({
            data: {
              body: "Use a Map here instead",
              user: { login: "coderabbitai[bot]", type: "Bot" },
              html_url: "https://github.com/o/r/pull/1#discussion_r100",
              path: "src/cache.ts",
              line: 10,
              original_line: 10,
              original_commit_id: "abc123",
            },
          }),
        },
      },
    };

    const payload = {
      comment: {
        id: 200,
        body: "@gloss track",
        user: { login: "mbatrakov", type: "User" },
        in_reply_to_id: 100,
        path: "src/cache.ts",
        line: 10,
        original_line: 10,
        original_commit_id: "abc123",
        html_url: "https://github.com/o/r/pull/1#discussion_r200",
      },
      pull_request: {
        number: 1,
        title: "Add cache",
        html_url: "https://github.com/o/r/pull/1",
        user: { login: "author" },
      },
      repository: {
        owner: { login: "o" },
        name: "r",
        full_name: "o/r",
        default_branch: "main",
      },
    };

    const ctx = await extractContext(
      octokit as never,
      "pull_request_review_comment",
      payload,
    );

    expect(ctx.type).toBe("structured");
    expect(ctx.usesOwnCommentAsSuggestion).toBe(false);
    expect(ctx.suggestion.body).toBe("Use a Map here instead");
    expect(ctx.suggestion.author).toBe("coderabbitai[bot]");
    expect(ctx.suggestion.author_type).toBe("bot");
    expect(ctx.location).toEqual({
      path: "src/cache.ts",
      start_line: 10,
      end_line: 10,
      original_commit_sha: "abc123",
    });
    expect(ctx.pr).toEqual({
      number: 1,
      title: "Add cache",
      url: "https://github.com/o/r/pull/1",
    });
    expect(ctx.deferred_by).toBe("mbatrakov");
    expect(ctx.prAuthorLogin).toBe("author");
  });

  it("creates freeform context from a standalone issue comment", async () => {
    const octokit = { rest: { pulls: { getReviewComment: vi.fn() } } };
    const payload = {
      comment: {
        id: 300,
        body: "@gloss track refactor auth module",
        user: { login: "mbatrakov", type: "User" },
        html_url: "https://github.com/o/r/pull/1#issuecomment-300",
      },
      issue: {
        number: 1,
        pull_request: { url: "https://api.github.com/repos/o/r/pulls/1" },
      },
      repository: {
        owner: { login: "o" },
        name: "r",
        full_name: "o/r",
        default_branch: "main",
      },
    };
    const prData = {
      title: "Auth changes",
      html_url: "https://github.com/o/r/pull/1",
      user: { login: "author" },
    };

    const ctx = await extractContext(
      octokit as never,
      "issue_comment",
      payload,
      prData,
    );

    expect(ctx.type).toBe("freeform");
    expect(ctx.usesOwnCommentAsSuggestion).toBe(true);
    expect(ctx.location).toBeNull();
    expect(ctx.suggestion.body).toBe("refactor auth module");
    expect(ctx.suggestion.author).toBe("mbatrakov");
    expect(ctx.suggestion.author_type).toBe("human");
  });

  it("treats standalone review comments without line metadata as freeform", async () => {
    const octokit = { rest: { pulls: { getReviewComment: vi.fn() } } };
    const payload = {
      comment: {
        id: 301,
        body: "@gloss track needs follow-up",
        user: { login: "mbatrakov", type: "User" },
        path: "src/cache.ts",
        line: null,
        original_line: null,
        original_commit_id: "abc123",
        html_url: "https://github.com/o/r/pull/1#discussion_r301",
      },
      pull_request: {
        number: 1,
        title: "Add cache",
        html_url: "https://github.com/o/r/pull/1",
        user: { login: "author" },
      },
      repository: {
        owner: { login: "o" },
        name: "r",
        full_name: "o/r",
        default_branch: "main",
      },
    };

    const ctx = await extractContext(
      octokit as never,
      "pull_request_review_comment",
      payload,
    );

    expect(ctx.type).toBe("freeform");
    expect(ctx.location).toBeNull();
    expect(ctx.usesOwnCommentAsSuggestion).toBe(true);
    expect(ctx.suggestion.body).toBe("needs follow-up");
  });

  it("falls back to freeform when issue comment parent lookup fails", async () => {
    const octokit = {
      rest: {
        pulls: {
          getReviewComment: vi.fn().mockRejectedValue({ status: 404 }),
        },
      },
    };
    const payload = {
      comment: {
        id: 500,
        body: "@gloss track some context",
        user: { login: "mbatrakov", type: "User" },
        html_url: "https://github.com/o/r/pull/1#issuecomment-500",
        in_reply_to_id: 999,
      },
      issue: {
        number: 1,
        pull_request: { url: "https://api.github.com/repos/o/r/pulls/1" },
      },
      repository: {
        owner: { login: "o" },
        name: "r",
        full_name: "o/r",
        default_branch: "main",
      },
    };
    const prData = {
      title: "PR",
      html_url: "https://github.com/o/r/pull/1",
      user: { login: "author" },
    };

    const ctx = await extractContext(
      octokit as never,
      "issue_comment",
      payload,
      prData,
    );

    expect(ctx.type).toBe("freeform");
    expect(ctx.usesOwnCommentAsSuggestion).toBe(true);
    expect(ctx.location).toBeNull();
    expect(ctx.suggestion.body).toBe("some context");
  });

  it("treats parent comments without line metadata as freeform", async () => {
    const octokit = {
      rest: {
        pulls: {
          getReviewComment: vi.fn().mockResolvedValue({
            data: {
              body: "Consider revisiting this flow",
              user: { login: "reviewer", type: "User" },
              html_url: "https://github.com/o/r/pull/1#discussion_r777",
              path: "src/auth.ts",
              line: null,
              original_line: null,
              original_commit_id: "def456",
            },
          }),
        },
      },
    };
    const payload = {
      comment: {
        id: 777,
        body: "@gloss track",
        user: { login: "mbatrakov", type: "User" },
        html_url: "https://github.com/o/r/pull/1#issuecomment-777",
        in_reply_to_id: 123,
      },
      issue: {
        number: 1,
        pull_request: { url: "https://api.github.com/repos/o/r/pulls/1" },
      },
      repository: {
        owner: { login: "o" },
        name: "r",
        full_name: "o/r",
        default_branch: "main",
      },
    };
    const prData = {
      title: "PR",
      html_url: "https://github.com/o/r/pull/1",
      user: { login: "author" },
    };

    const ctx = await extractContext(
      octokit as never,
      "issue_comment",
      payload,
      prData,
    );

    expect(ctx.type).toBe("freeform");
    expect(ctx.location).toBeNull();
    expect(ctx.usesOwnCommentAsSuggestion).toBe(false);
    expect(ctx.suggestion.body).toBe("Consider revisiting this flow");
  });

  it("rethrows non-404 parent lookup failures", async () => {
    const octokit = {
      rest: {
        pulls: {
          getReviewComment: vi.fn().mockRejectedValue({ status: 500 }),
        },
      },
    };
    const payload = {
      comment: {
        id: 501,
        body: "@gloss track some context",
        user: { login: "mbatrakov", type: "User" },
        html_url: "https://github.com/o/r/pull/1#issuecomment-501",
        in_reply_to_id: 999,
      },
      issue: {
        number: 1,
        pull_request: { url: "https://api.github.com/repos/o/r/pulls/1" },
      },
      repository: {
        owner: { login: "o" },
        name: "r",
        full_name: "o/r",
        default_branch: "main",
      },
    };
    const prData = {
      title: "PR",
      html_url: "https://github.com/o/r/pull/1",
      user: { login: "author" },
    };

    await expect(
      extractContext(octokit as never, "issue_comment", payload, prData),
    ).rejects.toEqual({ status: 500 });
  });
});

describe("inferSeverity", () => {
  it("returns medium for bot authors", () => {
    expect(inferSeverity("bot", "coderabbitai[bot]", "mbatrakov")).toBe(
      "medium",
    );
  });

  it("returns high for human non-author suggestions", () => {
    expect(inferSeverity("human", "reviewer", "author")).toBe("high");
  });

  it("returns low for self-deferral", () => {
    expect(inferSeverity("human", "mbatrakov", "mbatrakov")).toBe("low");
  });
});
