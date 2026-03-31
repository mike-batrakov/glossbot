import type { Octokit } from "@octokit/rest";
import { isHttpError } from "../schema/entry";
import type {
  AuthorType,
  EntryType,
  GlossLocation,
  GlossPr,
  GlossSuggestion,
  Severity,
} from "../schema/entry";

interface RepositoryPayload {
  owner: { login: string };
  name: string;
  full_name: string;
  default_branch: string;
}

interface CommentUser {
  login: string;
  type: string;
}

interface CommonCommentPayload {
  body: string;
  user: CommentUser | null;
  html_url: string;
  in_reply_to_id?: number;
}

interface ReviewCommentPayload extends CommonCommentPayload {
  path: string;
  line: number | null;
  original_line: number | null;
  original_commit_id: string;
}

interface PullRequestData {
  title: string;
  html_url: string;
  user: { login: string };
}

interface ReviewEventPullRequestData extends PullRequestData {
  number: number;
}

interface PullRequestReviewCommentEventPayload {
  repository: RepositoryPayload;
  comment: ReviewCommentPayload;
  pull_request: ReviewEventPullRequestData;
}

interface IssueCommentEventPayload {
  repository: RepositoryPayload;
  comment: CommonCommentPayload;
  issue: {
    number: number;
    pull_request: { url: string };
  };
}

interface ReviewCommentApiResponse {
  body: string;
  user: CommentUser | null;
  html_url: string;
  path: string;
  line: number | null;
  original_line: number | null;
  original_commit_id: string;
}

export interface ExtractedContext {
  type: EntryType;
  repo: string;
  defaultBranch: string;
  suggestion: GlossSuggestion;
  location: GlossLocation | null;
  pr: GlossPr;
  deferred_by: string;
  prAuthorLogin: string;
  usesOwnCommentAsSuggestion: boolean;
}

export async function extractContext(
  octokit: Octokit,
  eventName: "pull_request_review_comment" | "issue_comment",
  payload: unknown,
  prData?: PullRequestData,
): Promise<ExtractedContext> {
  if (eventName === "pull_request_review_comment") {
    return extractFromReviewComment(
      octokit,
      payload as PullRequestReviewCommentEventPayload,
    );
  }

  return extractFromIssueComment(
    octokit,
    payload as IssueCommentEventPayload,
    prData as PullRequestData,
  );
}

async function extractFromReviewComment(
  octokit: Octokit,
  payload: PullRequestReviewCommentEventPayload,
): Promise<ExtractedContext> {
  const repository = payload.repository;
  const comment = payload.comment;
  const pr: GlossPr = {
    number: payload.pull_request.number,
    title: payload.pull_request.title,
    url: payload.pull_request.html_url,
  };

  if (comment.in_reply_to_id !== undefined) {
    const parent = await fetchParentComment(
      octokit,
      repository.owner.login,
      repository.name,
      comment.in_reply_to_id,
    );

    if (parent !== null) {
      return {
        type: "structured",
        repo: repository.full_name,
        defaultBranch: repository.default_branch,
        suggestion: buildSuggestion(parent),
        location: buildLocation(parent),
        pr,
        deferred_by: getUserLogin(comment.user),
        prAuthorLogin: payload.pull_request.user.login,
        usesOwnCommentAsSuggestion: false,
      };
    }
  }

  return {
    type: "structured",
    repo: repository.full_name,
    defaultBranch: repository.default_branch,
    suggestion: {
      body: stripCommandPrefix(comment.body),
      author: getUserLogin(comment.user),
      author_type: detectAuthorType(comment.user?.type),
      url: comment.html_url,
    },
    location: buildLocation(comment),
    pr,
    deferred_by: getUserLogin(comment.user),
    prAuthorLogin: payload.pull_request.user.login,
    usesOwnCommentAsSuggestion: true,
  };
}

async function extractFromIssueComment(
  octokit: Octokit,
  payload: IssueCommentEventPayload,
  prData: PullRequestData,
): Promise<ExtractedContext> {
  const repository = payload.repository;
  const comment = payload.comment;
  const pr: GlossPr = {
    number: payload.issue.number,
    title: prData.title,
    url: prData.html_url,
  };

  if (comment.in_reply_to_id !== undefined) {
    const parent = await fetchParentComment(
      octokit,
      repository.owner.login,
      repository.name,
      comment.in_reply_to_id,
    );

    if (parent !== null) {
      return {
        type: "structured",
        repo: repository.full_name,
        defaultBranch: repository.default_branch,
        suggestion: buildSuggestion(parent),
        location: buildLocation(parent),
        pr,
        deferred_by: getUserLogin(comment.user),
        prAuthorLogin: prData.user.login,
        usesOwnCommentAsSuggestion: false,
      };
    }
  }

  return {
    type: "freeform",
    repo: repository.full_name,
    defaultBranch: repository.default_branch,
    suggestion: {
      body: stripCommandPrefix(comment.body),
      author: getUserLogin(comment.user),
      author_type: detectAuthorType(comment.user?.type),
      url: comment.html_url,
    },
    location: null,
    pr,
    deferred_by: getUserLogin(comment.user),
    prAuthorLogin: prData.user.login,
    usesOwnCommentAsSuggestion: true,
  };
}

async function fetchParentComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  commentId: number,
): Promise<ReviewCommentApiResponse | null> {
  try {
    const response = await octokit.rest.pulls.getReviewComment({
      owner,
      repo,
      comment_id: commentId,
    });

    return response.data as ReviewCommentApiResponse;
  } catch (error) {
    if (isHttpError(error) && error.status === 404) {
      return null;
    }

    throw error;
  }
}

function buildSuggestion(comment: ReviewCommentApiResponse): GlossSuggestion {
  return {
    body: comment.body,
    author: getUserLogin(comment.user),
    author_type: detectAuthorType(comment.user?.type),
    url: comment.html_url,
  };
}

function buildLocation(comment: {
  path: string;
  line: number | null;
  original_line: number | null;
  original_commit_id: string;
}): GlossLocation {
  const line = comment.original_line ?? comment.line ?? 0;

  return {
    path: comment.path,
    start_line: line,
    end_line: line,
    original_commit_sha: comment.original_commit_id,
  };
}

function detectAuthorType(userType: string | undefined): AuthorType {
  return userType === "Bot" ? "bot" : "human";
}

function getUserLogin(user: CommentUser | null): string {
  return user?.login ?? "";
}

function stripCommandPrefix(body: string): string {
  const stripped = body.replace(/^\s*@gloss\s+track\b\s*/i, "").trim();
  return stripped.length > 0 ? stripped : body;
}

export function inferSeverity(
  authorType: AuthorType,
  suggestionAuthor: string,
  prAuthorLogin: string,
): Severity {
  if (authorType === "bot") {
    return "medium";
  }

  return suggestionAuthor === prAuthorLogin ? "low" : "high";
}
