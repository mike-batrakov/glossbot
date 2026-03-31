import { describe, expect, it, vi } from "vitest";
import { handleInstall } from "../../src/handlers/install";

function buildAccessibleRepo(overrides: Record<string, unknown> = {}) {
  return {
    name: "r",
    full_name: "o/r",
    default_branch: "release/v1",
    owner: { login: "o" },
    ...overrides,
  };
}

function createMockContext(
  payloadOverrides: Record<string, unknown> = {},
  accessibleRepos: Array<Record<string, unknown>> = [buildAccessibleRepo()],
) {
  return {
    payload: {
      repositories: [
        {
          name: "r",
          full_name: "o/r",
        },
      ],
      ...payloadOverrides,
    },
    octokit: {
      rest: {
        apps: {
          listReposAccessibleToInstallation: vi.fn().mockResolvedValue({
            data: {
              repositories: accessibleRepos,
            },
          }),
        },
        repos: {
          get: vi.fn(),
          getContent: vi.fn(),
          createOrUpdateFileContents: vi.fn(),
        },
        issues: {
          listForRepo: vi.fn().mockResolvedValue({ data: [] }),
          create: vi.fn(),
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

    expect(
      context.octokit.rest.apps.listReposAccessibleToInstallation,
    ).toHaveBeenCalledWith({
      page: 1,
      per_page: 100,
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

  it("does nothing when both files already exist", async () => {
    const context = createMockContext();

    context.octokit.rest.repos.getContent
      .mockResolvedValueOnce({ data: { content: "", sha: "sha1" } })
      .mockResolvedValueOnce({ data: { content: "", sha: "sha2" } });

    await handleInstall(context as never);

    expect(
      context.octokit.rest.repos.createOrUpdateFileContents,
    ).not.toHaveBeenCalled();
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

  it("creates a setup issue when contents checks are forbidden", async () => {
    const context = createMockContext();

    context.octokit.rest.repos.getContent
      .mockRejectedValueOnce({ status: 403 })
      .mockRejectedValueOnce({ status: 403 });
    context.octokit.rest.issues.create.mockResolvedValue({});

    await handleInstall(context as never);

    expect(
      context.octokit.rest.repos.createOrUpdateFileContents,
    ).not.toHaveBeenCalled();
    expect(context.octokit.rest.issues.create).toHaveBeenCalledTimes(1);
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

  it("does not create a duplicate setup issue when one is already open", async () => {
    const context = createMockContext();

    context.octokit.rest.repos.getContent
      .mockRejectedValueOnce({ status: 403 })
      .mockRejectedValueOnce({ status: 403 });
    context.octokit.rest.issues.listForRepo.mockResolvedValue({
      data: [
        {
          title: "GlossBot setup requires default-branch write access",
        },
      ],
    });

    await handleInstall(context as never);

    expect(context.octokit.rest.issues.create).not.toHaveBeenCalled();
  });

  it("falls back to installation-accessible repositories when payload repositories are omitted", async () => {
    const context = createMockContext({
      repositories: undefined,
    });

    context.octokit.rest.repos.getContent
      .mockRejectedValueOnce({ status: 404 })
      .mockRejectedValueOnce({ status: 404 });
    context.octokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({});

    await handleInstall(context as never);

    expect(
      context.octokit.rest.apps.listReposAccessibleToInstallation,
    ).toHaveBeenCalled();
    expect(
      context.octokit.rest.repos.createOrUpdateFileContents,
    ).toHaveBeenCalledTimes(2);
  });
});
