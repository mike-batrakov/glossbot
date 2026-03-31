import type { GitHubClient } from "./client";
import { createMetadataLine, isHttpError } from "../schema/entry";

const GLOSSLOG_PATH = ".glosslog";
const MAX_PUT_ATTEMPTS = 3;

interface FileContent {
  content: string;
  sha: string;
}

function isFileContentPayload(data: unknown): data is { content: string; sha: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    !Array.isArray(data) &&
    "content" in data &&
    typeof data.content === "string" &&
    "sha" in data &&
    typeof data.sha === "string"
  );
}

export async function readGlosslog(
  octokit: GitHubClient,
  owner: string,
  repo: string,
  ref: string,
): Promise<FileContent | null> {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: GLOSSLOG_PATH,
      ref,
    });

    if (!isFileContentPayload(response.data)) {
      throw new Error(`Expected ${GLOSSLOG_PATH} to be a file with base64 content.`);
    }

    return {
      content: Buffer.from(response.data.content, "base64").toString("utf-8"),
      sha: response.data.sha,
    };
  } catch (error: unknown) {
    if (isHttpError(error) && error.status === 404) {
      return null;
    }

    throw error;
  }
}

export async function appendToGlosslog(
  octokit: GitHubClient,
  owner: string,
  repo: string,
  defaultBranch: string,
  newLine: string,
  commitMessage: string,
  metadataLine?: string,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_PUT_ATTEMPTS; attempt += 1) {
    try {
      const existing = await readGlosslog(octokit, owner, repo, defaultBranch);
      let nextContent = existing
        ? existing.content
        : metadataLine ?? createMetadataLine(`${owner}/${repo}`);

      if (nextContent && !nextContent.endsWith("\n")) {
        nextContent += "\n";
      }

      nextContent += `${newLine}\n`;

      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: GLOSSLOG_PATH,
        message: commitMessage,
        content: Buffer.from(nextContent).toString("base64"),
        branch: defaultBranch,
        ...(existing ? { sha: existing.sha } : {}),
      });

      return;
    } catch (error: unknown) {
      if (isHttpError(error) && error.status === 409 && attempt < MAX_PUT_ATTEMPTS - 1) {
        await jitter();
        continue;
      }

      throw error;
    }
  }
}

export async function createFile(
  octokit: GitHubClient,
  owner: string,
  repo: string,
  defaultBranch: string,
  path: string,
  content: string,
  commitMessage: string,
): Promise<void> {
  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message: commitMessage,
    content: Buffer.from(content).toString("base64"),
    branch: defaultBranch,
  });
}

export async function fileExists(
  octokit: GitHubClient,
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<boolean> {
  try {
    await octokit.rest.repos.getContent({ owner, repo, path, ref });
    return true;
  } catch (error: unknown) {
    if (isHttpError(error) && error.status === 404) {
      return false;
    }

    throw error;
  }
}

function jitter(): Promise<void> {
  const milliseconds = Math.random() * 100;
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
