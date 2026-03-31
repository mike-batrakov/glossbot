import type { Octokit } from "@octokit/rest";
import { appendToGlosslog } from "../github/contents";
import { formatReply, postReply } from "../github/comments";
import { extractContext, inferSeverity } from "../github/context";
import { parseCommand } from "../parser/command";
import {
  createEntry,
  createMetadataLine,
  isHttpError,
  type GlossSuggestion,
} from "../schema/entry";

interface TrackPayload {
  comment: {
    body: string;
    user: { login: string } | null;
  };
  repository: {
    owner: { login: string };
    name: string;
  };
  issue?: {
    number: number;
    pull_request?: unknown;
  };
  pull_request?: {
    number: number;
  };
}

interface PullSummary {
  title: string;
  html_url: string;
  user: { login: string };
}

interface TrackContext {
  payload: TrackPayload;
  octokit: unknown;
  log: {
    info: (message: string) => void;
    error: (message: string) => void;
  };
}

export async function handleTrack(
  context: TrackContext,
  eventName: "issue_comment" | "pull_request_review_comment",
): Promise<void> {
  const parsed = parseCommand(context.payload.comment.body);

  if (parsed === null) {
    return;
  }

  const owner = context.payload.repository.owner.login;
  const repo = context.payload.repository.name;
  const issueNumber = getIssueNumber(context.payload, eventName);
  const octokit = context.octokit as Octokit;

  try {
    const prData =
      eventName === "issue_comment"
        ? await loadPullRequest(octokit, owner, repo, issueNumber)
        : undefined;

    const extracted = await extractContext(
      octokit,
      eventName,
      context.payload,
      prData,
    );
    const suggestion = resolveSuggestion(
      extracted.usesOwnCommentAsSuggestion,
      extracted.suggestion,
      parsed.note,
    );
    const note = extracted.usesOwnCommentAsSuggestion ? null : parsed.note;
    const severity =
      parsed.severity ??
      inferSeverity(
        suggestion.author_type,
        suggestion.author,
        extracted.prAuthorLogin,
      );

    const entry = createEntry({
      type: extracted.type,
      repo: extracted.repo,
      suggestion,
      location: extracted.location,
      pr: extracted.pr,
      deferred_by: extracted.deferred_by,
      severity,
      tags: parsed.tags,
      note,
    });

    await appendToGlosslog(
      octokit,
      owner,
      repo,
      extracted.defaultBranch,
      JSON.stringify(entry),
      buildCommitMessage(entry.id, extracted.location),
      createMetadataLine(extracted.repo),
    );

    await postReply(
      octokit,
      owner,
      repo,
      issueNumber,
      formatReply({
        type: extracted.type,
        id: entry.id,
        path: extracted.location?.path ?? null,
        startLine: extracted.location?.start_line ?? null,
        severity: entry.severity,
        tags: entry.tags,
        deferredBy: entry.deferred_by,
        prNumber: extracted.pr.number,
        invalidOverrides: parsed.invalidOverrides,
      }),
    );

    context.log.info(`Tracked ${entry.id} in ${extracted.repo}`);
  } catch (error) {
    context.log.error(`Failed to track entry: ${String(error)}`);

    try {
      await postReply(
        octokit,
        owner,
        repo,
        issueNumber,
        buildErrorReply(error),
      );
    } catch (replyError) {
      context.log.error(`Failed to post error reply: ${String(replyError)}`);
    }
  }
}

function getIssueNumber(
  payload: TrackPayload,
  eventName: "issue_comment" | "pull_request_review_comment",
): number {
  if (eventName === "issue_comment") {
    if (payload.issue === undefined) {
      throw new Error("Issue payload missing issue metadata.");
    }

    return payload.issue.number;
  }

  if (payload.pull_request === undefined) {
    throw new Error("Review comment payload missing pull request metadata.");
  }

  return payload.pull_request.number;
}

async function loadPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<PullSummary> {
  const response = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: issueNumber,
  });

  return {
    title: response.data.title,
    html_url: response.data.html_url,
    user: {
      login: response.data.user?.login ?? "",
    },
  };
}

function resolveSuggestion(
  usesOwnCommentAsSuggestion: boolean,
  suggestion: GlossSuggestion,
  parsedNote: string | null,
): GlossSuggestion {
  if (!usesOwnCommentAsSuggestion) {
    return suggestion;
  }

  return {
    ...suggestion,
    body: parsedNote ?? suggestion.body,
  };
}

function buildCommitMessage(
  entryId: string,
  location: { path: string; start_line: number } | null,
): string {
  if (location === null) {
    return `gloss: track ${entryId} (freeform)`;
  }

  return `gloss: track ${entryId} in ${location.path}:${location.start_line}`;
}

function buildErrorReply(error: unknown): string {
  if (isHttpError(error) && error.status === 409) {
    return "Failed to track - concurrent write conflict. Please try again.";
  }

  if (isHttpError(error) && error.status === 403) {
    return "Failed to track - GlossBot does not have permission to write to the default branch.";
  }

  return "Failed to track - an unexpected error occurred. Please try again.";
}
