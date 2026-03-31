import { readFile } from "fs/promises";
import path from "path";
import type { Octokit } from "@octokit/rest";
import { createFile, fileExists } from "../github/contents";
import { createMetadataLine, isHttpError } from "../schema/entry";

const GLOSSLOG_PATH = ".glosslog";
const WORKFLOW_PATH = ".github/workflows/glossbot.yml";
const WORKFLOW_TEMPLATE_PATH = path.resolve(
  __dirname,
  "../../templates/glossbot.yml",
);

interface InstallRepository {
  name: string;
  full_name: string;
  default_branch: string;
  owner: { login: string };
}

interface InstallContext {
  payload: {
    repositories?: Array<{
      name: string;
      full_name: string;
    }>;
  };
  octokit: unknown;
  log: {
    info: (message: string) => void;
    error: (message: string) => void;
  };
}

export async function handleInstall(context: InstallContext): Promise<void> {
  const octokit = context.octokit as Octokit;
  const repositories = context.payload.repositories ?? [];

  for (const repositoryRef of repositories) {
    try {
      const repository = await loadRepository(octokit, repositoryRef);
      await setupRepository(octokit, repository);
      context.log.info(`Initialized install flow for ${repository.full_name}`);
    } catch (error) {
      context.log.error(
        `Failed to initialize install flow for ${repositoryRef.full_name}: ${String(error)}`,
      );
    }
  }
}

async function loadRepository(
  octokit: Octokit,
  repositoryRef: { name: string; full_name: string },
): Promise<InstallRepository> {
  const owner = parseOwner(repositoryRef.full_name);
  const response = await octokit.rest.repos.get({
    owner,
    repo: repositoryRef.name,
  });

  return {
    name: response.data.name,
    full_name: response.data.full_name,
    default_branch: response.data.default_branch,
    owner: {
      login: response.data.owner.login,
    },
  };
}

async function setupRepository(
  octokit: Octokit,
  repository: InstallRepository,
): Promise<void> {
  const owner = repository.owner.login;
  const repo = repository.name;
  const defaultBranch = repository.default_branch;
  const missingPaths: string[] = [];

  if (!(await fileExists(octokit, owner, repo, defaultBranch, GLOSSLOG_PATH))) {
    missingPaths.push(GLOSSLOG_PATH);
  }

  if (!(await fileExists(octokit, owner, repo, defaultBranch, WORKFLOW_PATH))) {
    missingPaths.push(WORKFLOW_PATH);
  }

  const forbiddenPaths: string[] = [];

  for (const filePath of missingPaths) {
    try {
      await createMissingFile(octokit, repository, filePath);
    } catch (error) {
      if (isHttpError(error) && error.status === 403) {
        forbiddenPaths.push(filePath);
        continue;
      }

      throw error;
    }
  }

  if (forbiddenPaths.length > 0) {
    await createSetupIssue(octokit, repository, forbiddenPaths);
  }
}

async function createMissingFile(
  octokit: Octokit,
  repository: InstallRepository,
  filePath: string,
): Promise<void> {
  const owner = repository.owner.login;
  const repo = repository.name;
  const defaultBranch = repository.default_branch;

  if (filePath === GLOSSLOG_PATH) {
    await createFile(
      octokit,
      owner,
      repo,
      defaultBranch,
      GLOSSLOG_PATH,
      `${createMetadataLine(repository.full_name)}\n`,
      "gloss: initialize .glosslog",
    );
    return;
  }

  if (filePath === WORKFLOW_PATH) {
    await createFile(
      octokit,
      owner,
      repo,
      defaultBranch,
      WORKFLOW_PATH,
      await renderWorkflowTemplate(defaultBranch),
      "gloss: add workflow",
    );
    return;
  }

  throw new Error(`Unsupported setup file path: ${filePath}`);
}

async function renderWorkflowTemplate(defaultBranch: string): Promise<string> {
  const template = await readFile(WORKFLOW_TEMPLATE_PATH, "utf-8");
  return template.replace("{{DEFAULT_BRANCH}}", JSON.stringify(defaultBranch));
}

async function createSetupIssue(
  octokit: Octokit,
  repository: InstallRepository,
  failedPaths: string[],
): Promise<void> {
  await octokit.rest.issues.create({
    owner: repository.owner.login,
    repo: repository.name,
    title: "GlossBot setup requires default-branch write access",
    body: buildSetupIssueBody(repository.default_branch, failedPaths),
  });
}

function buildSetupIssueBody(
  defaultBranch: string,
  failedPaths: string[],
): string {
  const paths = failedPaths.map((filePath) => `- \`${filePath}\``).join("\n");

  return [
    "GlossBot was installed, but automatic setup could not finish.",
    "",
    `GlossBot could not create the following files on the default branch \`${defaultBranch}\`:`,
    paths,
    "",
    "This usually means branch protection is blocking direct pushes or the app is missing push access / contents write access.",
    "",
    "To finish setup:",
    "1. Allow GlossBot to write to the default branch or adjust branch protection for app writes.",
    "2. Re-run installation or create the missing files manually after permissions are updated.",
  ].join("\n");
}

function parseOwner(fullName: string): string {
  const [owner] = fullName.split("/");

  if (owner === undefined || owner.length === 0) {
    throw new Error(`Invalid repository full name: ${fullName}`);
  }

  return owner;
}
