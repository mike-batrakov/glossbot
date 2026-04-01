import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleTrack } from "../../src/handlers/track";
import { loadGlosslogFixture, loadPayloadFixture } from "../helpers/fixtures";

function createMockContext(eventName: string, payload: Record<string, unknown>) {
  return {
    name: eventName,
    payload,
    octokit: {
      rest: {
        repos: {
          getContent: vi.fn(),
          createOrUpdateFileContents: vi.fn(),
        },
        issues: {
          createComment: vi.fn(),
        },
        pulls: {
          get: vi.fn().mockResolvedValue({
            data: {
              title: "Test PR",
              html_url: "https://github.com/o/r/pull/1",
              user: { login: "author" },
            },
          }),
          getReviewComment: vi.fn(),
        },
      },
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

function createReviewPayload(): Record<string, unknown> {
  return loadPayloadFixture<Record<string, unknown>>(
    "pull_request_review_comment.created",
  );
}

function createIssuePayload(): Record<string, unknown> {
  return loadPayloadFixture<Record<string, unknown>>("issue_comment.created");
}

function createReviewCommentData(): Record<string, unknown> {
  return loadPayloadFixture<Record<string, unknown>>("review_comment.data");
}

describe("handleTrack", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks a structured entry from a review comment reply", async () => {
    const payload = createReviewPayload();
    (payload.pull_request as Record<string, unknown>).title = "Test PR";
    const context = createMockContext("pull_request_review_comment", payload);
    const parentComment = createReviewCommentData();
    parentComment.body = "Use Map instead of object";

    context.octokit.rest.pulls.getReviewComment.mockResolvedValue({
      data: parentComment,
    });
    context.octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(loadGlosslogFixture("metadata-only")).toString("base64"),
        sha: "sha123",
      },
    });
    context.octokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({});
    context.octokit.rest.issues.createComment.mockResolvedValue({});

    await handleTrack(context as never, "pull_request_review_comment");

    expect(
      context.octokit.rest.repos.createOrUpdateFileContents,
    ).toHaveBeenCalledTimes(1);
    const putArgs =
      context.octokit.rest.repos.createOrUpdateFileContents.mock.calls[0][0];
    const written = Buffer.from(putArgs.content, "base64").toString("utf-8");

    expect(written).toContain('"type":"structured"');
    expect(written).toContain('"severity":"medium"');
    expect(written).toContain('"body":"Use Map instead of object"');

    expect(context.octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
    const replyBody =
      context.octokit.rest.issues.createComment.mock.calls[0][0].body;
    expect(replyBody).toContain("Tracked `src/cache.ts:10`");
  });

  it("tracks a standalone issue comment as freeform without duplicating note", async () => {
    const payload = createIssuePayload();
    (payload.comment as Record<string, unknown>).body =
      "@gloss track severity:high tag:v2 refactor auth module";
    const context = createMockContext("issue_comment", payload);

    context.octokit.rest.repos.getContent.mockRejectedValue({ status: 404 });
    context.octokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({});
    context.octokit.rest.issues.createComment.mockResolvedValue({});

    await handleTrack(context as never, "issue_comment");

    const putArgs =
      context.octokit.rest.repos.createOrUpdateFileContents.mock.calls[0][0];
    const written = Buffer.from(putArgs.content, "base64").toString("utf-8");

    expect(written).toContain('"type":"freeform"');
    expect(written).toContain('"body":"refactor auth module"');
    expect(written).toContain('"severity":"high"');
    expect(written).toContain('"tags":["v2"]');
    expect(written).toContain('"note":null');

    const replyBody =
      context.octokit.rest.issues.createComment.mock.calls[0][0].body;
    expect(replyBody).toContain("Tracked (freeform)");
    expect(replyBody).toContain("severity: high · tags: `v2`");
  });

  it("does not store the raw command prefix for standalone override-only comments", async () => {
    const payload = createIssuePayload();
    (payload.comment as Record<string, unknown>).id = 350;
    (payload.comment as Record<string, unknown>).body =
      "@gloss track severity:high tag:v2";
    (payload.comment as Record<string, unknown>).html_url =
      "https://github.com/o/r/pull/1#issuecomment-350";
    const context = createMockContext("issue_comment", payload);

    context.octokit.rest.repos.getContent.mockRejectedValue({ status: 404 });
    context.octokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({});
    context.octokit.rest.issues.createComment.mockResolvedValue({});

    await handleTrack(context as never, "issue_comment");

    const putArgs =
      context.octokit.rest.repos.createOrUpdateFileContents.mock.calls[0][0];
    const written = Buffer.from(putArgs.content, "base64").toString("utf-8");

    expect(written).toContain('"body":"severity:high tag:v2"');
    expect(written).not.toContain('"body":"@gloss track severity:high tag:v2"');
  });

  it("ignores comments without the command", async () => {
    const payload = createIssuePayload();
    (payload.comment as Record<string, unknown>).id = 400;
    (payload.comment as Record<string, unknown>).body = "Looks good to me";
    (payload.comment as Record<string, unknown>).html_url =
      "https://github.com/o/r/pull/1#issuecomment-400";
    const context = createMockContext("issue_comment", payload);

    await handleTrack(context as never, "issue_comment");

    expect(
      context.octokit.rest.repos.createOrUpdateFileContents,
    ).not.toHaveBeenCalled();
    expect(context.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("posts a clear error reply when repeated conflicts exhaust retries", async () => {
    const payload = createIssuePayload();
    (payload.comment as Record<string, unknown>).id = 500;
    (payload.comment as Record<string, unknown>).body =
      "@gloss track some context";
    (payload.comment as Record<string, unknown>).html_url =
      "https://github.com/o/r/pull/1#issuecomment-500";
    const context = createMockContext("issue_comment", payload);

    context.octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(loadGlosslogFixture("metadata-only")).toString("base64"),
        sha: "sha123",
      },
    });
    context.octokit.rest.repos.createOrUpdateFileContents.mockRejectedValue({
      status: 409,
    });
    context.octokit.rest.issues.createComment.mockResolvedValue({});

    const promise = handleTrack(context as never, "issue_comment");
    await vi.runAllTimersAsync();
    await promise;

    const replyBody =
      context.octokit.rest.issues.createComment.mock.calls[0][0].body;
    expect(replyBody).toContain(
      "Failed to track - concurrent write conflict. Please try again.",
    );
  });

  it("does not post a failure reply when only the confirmation comment fails", async () => {
    const payload = createIssuePayload();
    (payload.comment as Record<string, unknown>).id = 550;
    (payload.comment as Record<string, unknown>).html_url =
      "https://github.com/o/r/pull/1#issuecomment-550";
    const context = createMockContext("issue_comment", payload);

    context.octokit.rest.repos.getContent.mockRejectedValue({ status: 404 });
    context.octokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({});
    context.octokit.rest.issues.createComment.mockRejectedValue(
      new Error("comment API unavailable"),
    );

    await handleTrack(context as never, "issue_comment");

    expect(
      context.octokit.rest.repos.createOrUpdateFileContents,
    ).toHaveBeenCalledTimes(1);
    expect(context.octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
    expect(context.log.info).toHaveBeenCalledWith(
      expect.stringContaining("Tracked"),
    );
    expect(context.log.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to post confirmation reply"),
    );
  });
});
