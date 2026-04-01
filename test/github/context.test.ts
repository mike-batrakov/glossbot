import { describe, expect, it, vi } from "vitest";
import {
  extractContext,
  inferSeverity,
  type IssueCommentEventPayload,
  type PullRequestData,
  type PullRequestReviewCommentEventPayload,
} from "../../src/github/context";
import { loadPayloadFixture } from "../helpers/fixtures";

function createReviewPayload(): PullRequestReviewCommentEventPayload {
  return loadPayloadFixture<PullRequestReviewCommentEventPayload>(
    "pull_request_review_comment.created",
  );
}

function createIssuePayload(): IssueCommentEventPayload {
  return loadPayloadFixture<IssueCommentEventPayload>("issue_comment.created");
}

function createPullRequestData(): PullRequestData {
  return loadPayloadFixture<PullRequestData>("pull_request.data");
}

function createReviewCommentData(): Record<string, unknown> {
  return loadPayloadFixture<Record<string, unknown>>("review_comment.data");
}

describe("extractContext", () => {
  it("uses the parent review comment for structured review replies", async () => {
    const octokit = {
      rest: {
        pulls: {
          getReviewComment: vi.fn().mockResolvedValue({
            data: createReviewCommentData(),
          }),
        },
      },
    };
    const payload = createReviewPayload();

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

  it("preserves multi-line review comment ranges", async () => {
    const parent = createReviewCommentData();
    parent.body = "Split this helper into two focused functions";
    parent.user = { login: "reviewer", type: "User" };
    parent.html_url = "https://github.com/o/r/pull/1#discussion_r101";
    parent.start_line = 8;
    parent.original_start_line = 8;
    parent.line = 12;
    parent.original_line = 12;
    parent.original_commit_id = "abc124";

    const octokit = {
      rest: {
        pulls: {
          getReviewComment: vi.fn().mockResolvedValue({
            data: parent,
          }),
        },
      },
    };
    const payload = createReviewPayload();
    payload.comment.id = 201;
    payload.comment.in_reply_to_id = 101;
    payload.comment.line = 12;
    payload.comment.original_line = 12;
    payload.comment.original_commit_id = "abc124";
    payload.comment.html_url = "https://github.com/o/r/pull/1#discussion_r201";

    const ctx = await extractContext(
      octokit as never,
      "pull_request_review_comment",
      payload,
    );

    expect(ctx.type).toBe("structured");
    expect(ctx.location).toEqual({
      path: "src/cache.ts",
      start_line: 8,
      end_line: 12,
      original_commit_sha: "abc124",
    });
  });

  it("creates freeform context from a standalone issue comment", async () => {
    const octokit = { rest: { pulls: { getReviewComment: vi.fn() } } };
    const payload = createIssuePayload();
    const prData = createPullRequestData();

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
    const payload = createReviewPayload();
    delete payload.comment.in_reply_to_id;
    payload.comment.id = 301;
    payload.comment.body = "@gloss track needs follow-up";
    payload.comment.line = null;
    payload.comment.original_line = null;
    payload.comment.html_url = "https://github.com/o/r/pull/1#discussion_r301";

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
    const payload = createIssuePayload();
    payload.comment.id = 500;
    payload.comment.body = "@gloss track some context";
    payload.comment.html_url = "https://github.com/o/r/pull/1#issuecomment-500";
    payload.comment.in_reply_to_id = 999;
    const prData = createPullRequestData();
    prData.title = "PR";

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
    const parent = createReviewCommentData();
    parent.body = "Consider revisiting this flow";
    parent.user = { login: "reviewer", type: "User" };
    parent.html_url = "https://github.com/o/r/pull/1#discussion_r777";
    parent.path = "src/auth.ts";
    parent.line = null;
    parent.original_line = null;
    parent.original_commit_id = "def456";

    const octokit = {
      rest: {
        pulls: {
          getReviewComment: vi.fn().mockResolvedValue({
            data: parent,
          }),
        },
      },
    };
    const payload = createIssuePayload();
    payload.comment.id = 777;
    payload.comment.body = "@gloss track";
    payload.comment.html_url = "https://github.com/o/r/pull/1#issuecomment-777";
    payload.comment.in_reply_to_id = 123;
    const prData = createPullRequestData();
    prData.title = "PR";

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
    const payload = createIssuePayload();
    payload.comment.id = 501;
    payload.comment.body = "@gloss track some context";
    payload.comment.html_url = "https://github.com/o/r/pull/1#issuecomment-501";
    payload.comment.in_reply_to_id = 999;
    const prData = createPullRequestData();
    prData.title = "PR";

    await expect(
      extractContext(octokit as never, "issue_comment", payload, prData),
    ).rejects.toEqual({ status: 500 });
  });

  it("throws when the comment user login is unavailable", async () => {
    const octokit = { rest: { pulls: { getReviewComment: vi.fn() } } };
    const payload = createIssuePayload();
    payload.comment.id = 600;
    payload.comment.user = null;
    payload.comment.html_url = "https://github.com/o/r/pull/1#issuecomment-600";
    const prData = createPullRequestData();

    await expect(
      extractContext(octokit as never, "issue_comment", payload, prData),
    ).rejects.toThrow("Could not determine user login for comment.");
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
