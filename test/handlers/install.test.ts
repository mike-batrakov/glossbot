import { describe, expect, it, vi } from "vitest";
import { handleInstall } from "../../src/handlers/install";

function createMockContext() {
  return {
    payload: {
      repositories: [
        {
          name: "r",
          full_name: "o/r",
        },
      ],
    },
    octokit: {
      rest: {
        repos: {
          get: vi.fn().mockResolvedValue({
            data: {
              name: "r",
              full_name: "o/r",
              default_branch: "release/v1",
              owner: { login: "o" },
            },
          }),
          getContent: vi.fn(),
          createOrUpdateFileContents: vi.fn(),
        },
        issues: {
          create: vi.fn(),
        },
      },
    },
    log: {
      info: vi.fn(),
      error: vi.fn(),
    },
  };
}

function decodeWriteContent(content: string): string {
  return Buffer.from(content, "base64").toString("utf-8");
}

describe("handleInstall", () => {
  it("initializes .glosslog and workflow when both files are missing", async () => {
    const context = createMockContext();

    context.octokit.rest.repos.getContent
      .mockRejectedValueOnce({ status: 404 })
      .mockRejectedValueOnce({ status: 404 });
    context.octokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({});

    await handleInstall(context as never);

    expect(context.octokit.rest.repos.get).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
    });
    expect(context.octokit.rest.repos.getContent).toHaveBeenNthCalledWith(1, {
      owner: "o",
      repo: "r",
      path: ".glosslog",
      ref: "release/v1",
    });
    expect(context.octokit.rest.repos.getContent).toHaveBeenNthCalledWith(2, {
      owner: "o",
      repo: "r",
      path: ".github/workflows/glossbot.yml",
      ref: "release/v1",
    });
    expect(
      context.octokit.rest.repos.createOrUpdateFileContents,
    ).toHaveBeenCalledTimes(2);

    const glosslogWrite =
      context.octokit.rest.repos.createOrUpdateFileContents.mock.calls[0][0];
    expect(glosslogWrite.path).toBe(".glosslog");
    const glosslogContent = decodeWriteContent(glosslogWrite.content);
    const metadata = JSON.parse(glosslogContent);
    expect(metadata).toMatchObject({
      _type: "glosslog",
      version: 1,
      repo: "o/r",
    });
    expect(glosslogContent.endsWith("\n")).toBe(true);

    const workflowWrite =
      context.octokit.rest.repos.createOrUpdateFileContents.mock.calls[1][0];
    expect(workflowWrite.path).toBe(".github/workflows/glossbot.yml");
    const workflowContent = decodeWriteContent(workflowWrite.content);
    expect(workflowContent).toContain('- "release/v1"');
    expect(workflowContent).toContain("glossbot/generate-gloss-md@v1");

    expect(context.octokit.rest.issues.create).not.toHaveBeenCalled();
  });

  it("creates only the missing workflow when .glosslog already exists", async () => {
    const context = createMockContext();

    context.octokit.rest.repos.getContent
      .mockResolvedValueOnce({ data: { content: "", sha: "sha123" } })
      .mockRejectedValueOnce({ status: 404 });
    context.octokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({});

    await handleInstall(context as never);

    expect(
      context.octokit.rest.repos.createOrUpdateFileContents,
    ).toHaveBeenCalledTimes(1);
    expect(
      context.octokit.rest.repos.createOrUpdateFileContents.mock.calls[0][0].path,
    ).toBe(".github/workflows/glossbot.yml");
    expect(context.octokit.rest.issues.create).not.toHaveBeenCalled();
  });

  it("creates a setup issue when contents writes are forbidden", async () => {
    const context = createMockContext();

    context.octokit.rest.repos.getContent
      .mockRejectedValueOnce({ status: 404 })
      .mockRejectedValueOnce({ status: 404 });
    context.octokit.rest.repos.createOrUpdateFileContents
      .mockRejectedValueOnce({ status: 403 })
      .mockRejectedValueOnce({ status: 403 });
    context.octokit.rest.issues.create.mockResolvedValue({});

    await handleInstall(context as never);

    expect(context.octokit.rest.repos.getContent).toHaveBeenCalledTimes(2);
    expect(
      context.octokit.rest.repos.createOrUpdateFileContents,
    ).toHaveBeenCalledTimes(2);
    expect(context.octokit.rest.issues.create).toHaveBeenCalledTimes(1);

    const issueArgs = context.octokit.rest.issues.create.mock.calls[0][0];
    expect(issueArgs).toMatchObject({
      owner: "o",
      repo: "r",
      title: "GlossBot setup requires default-branch write access",
    });
    expect(issueArgs.body).toContain("branch protection");
    expect(issueArgs.body).toContain("push access");
    expect(issueArgs.body).toContain(".glosslog");
    expect(issueArgs.body).toContain(".github/workflows/glossbot.yml");
  });
});
