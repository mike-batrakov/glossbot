import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleTrack } from "../../src/handlers/track";

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

describe("handleTrack", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks a structured entry from a review comment reply", async () => {
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
        title: "Test PR",
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
    const context = createMockContext("pull_request_review_comment", payload);

    context.octokit.rest.pulls.getReviewComment.mockResolvedValue({
      data: {
        body: "Use Map instead of object",
        user: { login: "coderabbitai[bot]", type: "Bot" },
        html_url: "https://github.com/o/r/pull/1#discussion_r100",
        path: "src/cache.ts",
        line: 10,
        original_line: 10,
        original_commit_id: "abc123",
      },
    });
    context.octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from('{"_type":"glosslog","version":1}\n').toString(
          "base64",
        ),
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
    const payload = {
      comment: {
        id: 300,
        body: "@gloss track severity:high tag:v2 refactor auth module",
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
    expect(replyBody).toContain("severity: high · tags: v2");
  });

  it("does not store the raw command prefix for standalone override-only comments", async () => {
    const payload = {
      comment: {
        id: 350,
        body: "@gloss track severity:high tag:v2",
        user: { login: "mbatrakov", type: "User" },
        html_url: "https://github.com/o/r/pull/1#issuecomment-350",
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
    const payload = {
      comment: {
        id: 400,
        body: "Looks good to me",
        user: { login: "mbatrakov", type: "User" },
        html_url: "https://github.com/o/r/pull/1#issuecomment-400",
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
    const context = createMockContext("issue_comment", payload);

    await handleTrack(context as never, "issue_comment");

    expect(
      context.octokit.rest.repos.createOrUpdateFileContents,
    ).not.toHaveBeenCalled();
    expect(context.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("posts a clear error reply when repeated conflicts exhaust retries", async () => {
    const payload = {
      comment: {
        id: 500,
        body: "@gloss track some context",
        user: { login: "mbatrakov", type: "User" },
        html_url: "https://github.com/o/r/pull/1#issuecomment-500",
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
    const context = createMockContext("issue_comment", payload);

    context.octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from('{"_type":"glosslog","version":1}\n').toString(
          "base64",
        ),
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
});
