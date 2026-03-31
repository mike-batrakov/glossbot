import { existsSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import type { Octokit } from "@octokit/rest";
import { createFile, fileExists } from "../github/contents";
import { createMetadataLine, isHttpError } from "../schema/entry";

const GLOSSLOG_PATH = ".glosslog";
const WORKFLOW_PATH = ".github/workflows/glossbot.yml";
const SETUP_ISSUE_TITLE = "GlossBot setup requires default-branch write access";
const TEMPLATE_CANDIDATE_PATHS = [
  path.resolve(__dirname, "../../templates/glossbot.yml"),
  path.resolve(__dirname, "../templates/glossbot.yml"),
];
const PAGE_SIZE = 100;

let workflowTemplatePromise: Promise<string> | null = null;

interface RepositoryRef {
  name: string;
  full_name: string;
}

interface InstallRepository {
  name: string;
  full_name: string;
  default_branch: string;
  owner: { login: string };
}

interface InstallContext {
  payload: {
    repositories?: RepositoryRef[];
    repositories_added?: RepositoryRef[];
  };
  octokit: unknown;
  log: {
    info: (message: string) => void;
    warn?: (message: string) => void;
    error: (message: string) => void;
  };
}

export async function handleInstall(context: InstallContext): Promise<void> {
  const octokit = context.octokit as Octokit;
  const repositories = await loadRepositories(octokit, context.payload);

  for (const repository of repositories) {
    try {
      const result = await setupRepository(octokit, repository);

      if (result.needsManualSetup) {
        logWarn(
          context,
          `Install flow requires manual setup for ${repository.full_name}`,
        );
        continue;
      }

      if (result.createdPaths.length === 0) {
        context.log.info(`Install flow already configured for ${repository.full_name}`);
        continue;
      }

      context.log.info(`Initialized install flow for ${repository.full_name}`);
    } catch (error) {
      context.log.error(
        `Failed to initialize install flow for ${repository.full_name}: ${String(error)}`,
      );
    }
  }
}

async function loadRepositories(
  octokit: Octokit,
  payload: InstallContext["payload"],
): Promise<InstallRepository[]> {
  const requestedRepositories = payload.repositories ?? payload.repositories_added;

  if (requestedRepositories === undefined) {
    return listAccessibleRepositories(octokit);
  }

  return Promise.all(
    requestedRepositories.map((repositoryRef) =>
      loadRepository(octokit, repositoryRef),
    ),
  );
}

async function listAccessibleRepositories(octokit: Octokit): Promise<InstallRepository[]> {
  const repositories: InstallRepository[] = [];

  for (let page = 1; ; page += 1) {
    const response = await octokit.rest.apps.listReposAccessibleToInstallation({
      page,
      per_page: PAGE_SIZE,
    });
    const pageRepositories = response.data.repositories.map(toInstallRepository);

    repositories.push(...pageRepositories);

    if (pageRepositories.length < PAGE_SIZE) {
      return repositories;
    }
  }
}

async function loadRepository(
  octokit: Octokit,
  repositoryRef: RepositoryRef,
): Promise<InstallRepository> {
  const owner = parseOwner(repositoryRef.full_name);
  const response = await octokit.rest.repos.get({ owner, repo: repositoryRef.name });
  return toInstallRepository(response.data);
}

async function setupRepository(
  octokit: Octokit,
  repository: InstallRepository,
): Promise<{ createdPaths: string[]; needsManualSetup: boolean }> {
  const owner = repository.owner.login;
  const repo = repository.name;
  const defaultBranch = repository.default_branch;
  const missingPaths: string[] = [];
  const forbiddenPaths: string[] = [];

  for (const filePath of [GLOSSLOG_PATH, WORKFLOW_PATH]) {
    try {
      if (!(await fileExists(octokit, owner, repo, defaultBranch, filePath))) {
        missingPaths.push(filePath);
      }
    } catch (error) {
      if (isHttpError(error) && error.status === 403) {
        forbiddenPaths.push(filePath);
        continue;
      }

      throw error;
    }
  }

  const createdPaths: string[] = [];

  for (const filePath of missingPaths) {
    try {
      await createMissingFile(octokit, repository, filePath);
      createdPaths.push(filePath);
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
    return {
      createdPaths,
      needsManualSetup: true,
    };
  }

  return {
    createdPaths,
    needsManualSetup: false,
  };
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
  const template = await loadWorkflowTemplate();
  return template.replace(/{{DEFAULT_BRANCH}}/g, JSON.stringify(defaultBranch));
}

async function createSetupIssue(
  octokit: Octokit,
  repository: InstallRepository,
  failedPaths: string[],
): Promise<void> {
  for await (const response of octokit.paginate.iterator(
    octokit.rest.issues.listForRepo,
    {
      owner: repository.owner.login,
      repo: repository.name,
      state: "open",
      per_page: 100,
    },
  )) {
    if (
      response.data.some(
        (issue) =>
          issue.pull_request === undefined && issue.title === SETUP_ISSUE_TITLE,
      )
    ) {
      return;
    }
  }

  await octokit.rest.issues.create({
    owner: repository.owner.login,
    repo: repository.name,
    title: SETUP_ISSUE_TITLE,
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

function toInstallRepository(repository: {
  name: string;
  full_name: string;
  default_branch: string;
  owner: { login: string };
}): InstallRepository {
  return {
    name: repository.name,
    full_name: repository.full_name,
    default_branch: repository.default_branch,
    owner: {
      login: repository.owner.login,
    },
  };
}

async function loadWorkflowTemplate(): Promise<string> {
  if (workflowTemplatePromise !== null) {
    return workflowTemplatePromise;
  }

  workflowTemplatePromise = (async () => {
    for (const templatePath of TEMPLATE_CANDIDATE_PATHS) {
      if (existsSync(templatePath)) {
        return readFile(templatePath, "utf-8");
      }
    }

    throw new Error("GlossBot workflow template is missing from the runtime artifact.");
  })();

  return workflowTemplatePromise;
}

function logWarn(context: InstallContext, message: string): void {
  if (context.log.warn !== undefined) {
    context.log.warn(message);
    return;
  }

  context.log.info(message);
}
