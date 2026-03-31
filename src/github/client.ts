import type { Octokit } from "@octokit/rest";

export type GitHubClient = Pick<Octokit, "rest">;
