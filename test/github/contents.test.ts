import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendToGlosslog, readGlosslog } from "../../src/github/contents";

function createMockOctokit(overrides: Record<string, unknown> = {}) {
  return {
    rest: {
      repos: {
        getContent: vi.fn(),
        createOrUpdateFileContents: vi.fn(),
      },
    },
    ...overrides,
  };
}

describe("readGlosslog", () => {
  it("returns decoded content and sha when file exists", async () => {
    const octokit = createMockOctokit();
    const content = '{"_type":"glosslog","version":1}\n';

    octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(content).toString("base64"),
        sha: "abc123",
      },
    });

    const result = await readGlosslog(octokit as never, "owner", "repo", "main");
    expect(result).toEqual({ content, sha: "abc123" });
  });

  it("returns null when file does not exist", async () => {
    const octokit = createMockOctokit();
    octokit.rest.repos.getContent.mockRejectedValue({ status: 404 });

    const result = await readGlosslog(octokit as never, "owner", "repo", "main");
    expect(result).toBeNull();
  });

  it("throws on non-404 errors", async () => {
    const octokit = createMockOctokit();
    octokit.rest.repos.getContent.mockRejectedValue({ status: 500 });

    await expect(
      readGlosslog(octokit as never, "owner", "repo", "main"),
    ).rejects.toEqual({ status: 500 });
  });

  it("throws when .glosslog resolves to a non-file payload", async () => {
    const octokit = createMockOctokit();
    octokit.rest.repos.getContent.mockResolvedValue({ data: [] });

    await expect(
      readGlosslog(octokit as never, "owner", "repo", "main"),
    ).rejects.toThrow("Expected .glosslog to be a file with base64 content.");
  });
});

describe("appendToGlosslog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("appends a line to an existing file", async () => {
    const octokit = createMockOctokit();
    const existing = '{"_type":"glosslog","version":1}\n';

    octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(existing).toString("base64"),
        sha: "abc123",
      },
    });
    octokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({});

    const newLine = '{"_type":"entry","id":"g_12345678"}';
    await appendToGlosslog(
      octokit as never,
      "owner",
      "repo",
      "main",
      newLine,
      "gloss: track g_12345678",
    );

    const putCall = octokit.rest.repos.createOrUpdateFileContents.mock.calls[0][0];
    expect(putCall.sha).toBe("abc123");

    const decoded = Buffer.from(putCall.content, "base64").toString("utf-8");
    expect(decoded).toBe(existing + newLine + "\n");
    expect(putCall.message).toBe("gloss: track g_12345678");
  });

  it("normalizes a missing trailing newline before appending", async () => {
    const octokit = createMockOctokit();
    const existing = '{"_type":"glosslog","version":1}';

    octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(existing).toString("base64"),
        sha: "abc123",
      },
    });
    octokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({});

    const newLine = '{"_type":"entry","id":"g_12345678"}';
    await appendToGlosslog(
      octokit as never,
      "owner",
      "repo",
      "main",
      newLine,
      "gloss: track g_12345678",
    );

    const putCall = octokit.rest.repos.createOrUpdateFileContents.mock.calls[0][0];
    const decoded = Buffer.from(putCall.content, "base64").toString("utf-8");

    expect(decoded).toBe(`${existing}\n${newLine}\n`);
  });

  it("creates a new file with metadata when none exists", async () => {
    const octokit = createMockOctokit();
    octokit.rest.repos.getContent.mockRejectedValue({ status: 404 });
    octokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({});

    const newLine = '{"_type":"entry","id":"g_12345678"}';
    const metadataLine = '{"_type":"glosslog","version":1,"repo":"owner/repo"}';

    await appendToGlosslog(
      octokit as never,
      "owner",
      "repo",
      "main",
      newLine,
      "gloss: track g_12345678",
      metadataLine,
    );

    const putCall = octokit.rest.repos.createOrUpdateFileContents.mock.calls[0][0];
    expect(putCall.sha).toBeUndefined();

    const decoded = Buffer.from(putCall.content, "base64").toString("utf-8");
    expect(decoded).toBe(metadataLine + "\n" + newLine + "\n");
  });

  it("retries on 409 conflict", async () => {
    const octokit = createMockOctokit();
    const content = '{"_type":"glosslog"}\n';

    octokit.rest.repos.getContent
      .mockResolvedValueOnce({
        data: {
          content: Buffer.from(content).toString("base64"),
          sha: "sha1",
        },
      })
      .mockResolvedValueOnce({
        data: {
          content: Buffer.from(content).toString("base64"),
          sha: "sha2",
        },
      });

    octokit.rest.repos.createOrUpdateFileContents
      .mockRejectedValueOnce({ status: 409 })
      .mockResolvedValueOnce({});

    const promise = appendToGlosslog(
      octokit as never,
      "owner",
      "repo",
      "main",
      '{"_type":"entry"}',
      "msg",
    );
    await vi.runAllTimersAsync();
    await promise;

    expect(octokit.rest.repos.getContent).toHaveBeenCalledTimes(2);
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(2);
  });

  it("throws after max retries on repeated 409 conflicts", async () => {
    const octokit = createMockOctokit();
    const content = '{"_type":"glosslog"}\n';

    octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(content).toString("base64"),
        sha: "sha1",
      },
    });
    octokit.rest.repos.createOrUpdateFileContents.mockRejectedValue({ status: 409 });

    const promise = appendToGlosslog(
      octokit as never,
      "owner",
      "repo",
      "main",
      '{"_type":"entry"}',
      "msg",
    );
    const rejection = expect(promise).rejects.toEqual({ status: 409 });
    await vi.runAllTimersAsync();
    await rejection;

    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(3);
  });
});
