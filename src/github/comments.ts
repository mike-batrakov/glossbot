import type { GitHubClient } from "./client";
import { suggestSeverity } from "../parser/levenshtein";
import type { InvalidOverride } from "../parser/command";
import type { EntryType, Severity } from "../schema/entry";

export interface ReplyInput {
  type: EntryType;
  id: string;
  path: string | null;
  startLine: number | null;
  endLine: number | null;
  severity: Severity;
  tags: string[];
  deferredBy: string;
  prNumber: number;
  invalidOverrides: InvalidOverride[];
}

export function formatReply(input: ReplyInput): string {
  const location =
    input.type === "structured" && input.path !== null && input.startLine !== null
      ? formatCode(formatLocation(input.path, input.startLine, input.endLine))
      : "(freeform)";
  const tags =
    input.tags.length > 0 ? input.tags.map(renderTag).join(", ") : "none";

  const lines = [
    `Tracked ${location} · ${input.id}`,
    `severity: ${input.severity} · tags: ${tags}`,
    `Deferred by @${input.deferredBy} on PR #${input.prNumber}`,
  ];

  for (const override of input.invalidOverrides) {
    const suggestion =
      override.key === "severity" ? suggestSeverity(override.value) : null;

    if (suggestion === null) {
      lines.push(
        "",
        `Unrecognized: ${formatCode(`${override.key}:${override.value}`)}`,
      );
      continue;
    }

    lines.push(
      "",
      `Unrecognized: ${formatCode(`${override.key}:${override.value}`)} - did you mean ${formatCode(`${override.key}:${suggestion}`)}?`,
    );
  }

  return lines.join("\n");
}

export async function postReply(
  octokit: GitHubClient,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}

function formatLocation(
  path: string,
  startLine: number,
  endLine: number | null,
): string {
  if (endLine === null || endLine === startLine) {
    return `${path}:${startLine}`;
  }

  return `${path}:${startLine}-${endLine}`;
}

function renderTag(value: string): string {
  return formatCode(value);
}

function formatCode(value: string): string {
  const longestRun = Math.max(
    ...Array.from(value.matchAll(/`+/g), (match) => match[0].length),
    0,
  );
  const fence = "`".repeat(longestRun + 1);
  return `${fence}${value}${fence}`;
}
