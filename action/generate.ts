import { readFileSync, writeFileSync } from "node:fs";

type Severity = "critical" | "high" | "medium" | "low";
type EntryType = "structured" | "freeform";
type AuthorType = "bot" | "human";

interface GlossLocation {
  path: string;
  start_line: number;
  end_line: number;
  original_commit_sha: string;
}

interface GlossEntry {
  _type: "entry";
  id: string;
  version: number;
  type: EntryType;
  repo: string;
  created_at: string;
  source: "github-pr";
  suggestion: {
    body: string;
    author: string;
    author_type: AuthorType;
    url: string;
  };
  location: GlossLocation | null;
  pr: {
    number: number;
    title: string;
    url: string;
  };
  deferred_by: string;
  severity: Severity;
  tags: string[];
  note: string | null;
  status: string;
}

const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low"];
const GLOSSLOG_PATH = ".glosslog";
const OUTPUT_PATH = "GLOSS.md";

export function generateGlossMd(glosslogContent: string): string {
  const entries = parseEntries(glosslogContent);
  const structured = entries
    .filter((entry): entry is GlossEntry & { type: "structured"; location: GlossLocation } => {
      return entry.type === "structured" && entry.location !== null;
    })
    .sort(compareStructuredEntries);
  const freeform = entries
    .filter((entry): entry is GlossEntry & { type: "freeform"; location: null } => {
      return entry.type === "freeform" && entry.location === null;
    })
    .sort(compareFreeformEntries);

  const counts = countBySeverity(entries);
  const oldest = formatOldestDate(entries);
  const latest = formatLatestDate(entries);
  const sections: string[] = [
    "# Tech Debt Tracker",
    "",
    "> Auto-generated from `.glosslog`.",
    "> **Edits to this file will be overwritten.** Update `.glosslog` instead.",
    "",
    `**${entries.length} open items** · ${counts.critical} critical · ${counts.high} high · ${counts.medium} medium · ${counts.low} low · oldest: ${oldest}`,
  ];

  for (const severity of SEVERITIES) {
    const matches = structured.filter((entry) => entry.severity === severity);

    if (matches.length === 0) {
      continue;
    }

    sections.push("", "---", "", `## ${capitalize(severity)} (${matches.length})`, "");

    for (const entry of matches) {
      sections.push(renderStructuredEntry(entry), "");
    }
  }

  if (freeform.length > 0) {
    sections.push("", "---", "", `## Freeform (${freeform.length})`, "");
    sections.push(
      "These entries are included in the summary counts above but are listed separately because they have no file/line context.",
      "",
    );

    for (const entry of freeform) {
      sections.push(renderFreeformEntry(entry), "");
    }
  }

  sections.push("", "---", "", `*Last updated from .glosslog snapshot: ${latest}*`, "");

  return sections.join("\n");
}

function parseEntries(glosslogContent: string): GlossEntry[] {
  return glosslogContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const parsed = parseLine(line);

      return parsed === null ? [] : [parsed];
    });
}

function parseLine(line: string): GlossEntry | null {
  let value: unknown;

  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }

  if (!isRecord(value) || value._type !== "entry") {
    return null;
  }

  if (!isValidEntry(value) || value.status !== "open") {
    return null;
  }

  return toGlossEntry(value);
}

function isValidEntry(value: Record<string, unknown>): boolean {
  if (
    typeof value.id !== "string" ||
    typeof value.version !== "number" ||
    !isValidType(value.type) ||
    typeof value.repo !== "string" ||
    typeof value.created_at !== "string" ||
    Number.isNaN(Date.parse(value.created_at)) ||
    value.source !== "github-pr" ||
    !isValidSeverity(value.severity) ||
    typeof value.deferred_by !== "string" ||
    typeof value.status !== "string"
  ) {
    return false;
  }

  if (!isSuggestion(value.suggestion) || !isPullRequest(value.pr) || !isTags(value.tags)) {
    return false;
  }

  if (!(typeof value.note === "string" || value.note === null)) {
    return false;
  }

  if (value.type === "structured") {
    return isLocation(value.location);
  }

  return value.location === null;
}

function toGlossEntry(value: Record<string, unknown>): GlossEntry {
  const suggestion = value.suggestion as Record<string, unknown>;
  const pr = value.pr as Record<string, unknown>;
  const location =
    value.location === null ? null : (value.location as Record<string, unknown>);

  return {
    _type: "entry",
    id: value.id as string,
    version: value.version as number,
    type: value.type as EntryType,
    repo: value.repo as string,
    created_at: value.created_at as string,
    source: "github-pr",
    suggestion: {
      body: suggestion.body as string,
      author: suggestion.author as string,
      author_type: suggestion.author_type as AuthorType,
      url: suggestion.url as string,
    },
    location:
      location === null
        ? null
        : {
            path: location.path as string,
            start_line: location.start_line as number,
            end_line: location.end_line as number,
            original_commit_sha: location.original_commit_sha as string,
          },
    pr: {
      number: pr.number as number,
      title: pr.title as string,
      url: pr.url as string,
    },
    deferred_by: value.deferred_by as string,
    severity: value.severity as Severity,
    tags: value.tags as string[],
    note: value.note as string | null,
    status: value.status as string,
  };
}

function isValidType(value: unknown): value is EntryType {
  return value === "structured" || value === "freeform";
}

function isValidSeverity(value: unknown): value is Severity {
  return typeof value === "string" && SEVERITIES.includes(value as Severity);
}

function isSuggestion(value: unknown): value is GlossEntry["suggestion"] {
  return (
    isRecord(value) &&
    typeof value.body === "string" &&
    typeof value.author === "string" &&
    isAuthorType(value.author_type) &&
    typeof value.url === "string"
  );
}

function isPullRequest(value: unknown): value is GlossEntry["pr"] {
  return (
    isRecord(value) &&
    typeof value.number === "number" &&
    typeof value.title === "string" &&
    typeof value.url === "string"
  );
}

function isLocation(value: unknown): value is GlossLocation {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.start_line === "number" &&
    typeof value.end_line === "number" &&
    typeof value.original_commit_sha === "string"
  );
}

function isAuthorType(value: unknown): value is AuthorType {
  return value === "bot" || value === "human";
}

function isTags(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function compareStructuredEntries(left: GlossEntry, right: GlossEntry): number {
  const pathCompare = left.location!.path.localeCompare(right.location!.path);
  if (pathCompare !== 0) {
    return pathCompare;
  }

  const startCompare = left.location!.start_line - right.location!.start_line;
  if (startCompare !== 0) {
    return startCompare;
  }

  const createdCompare = left.created_at.localeCompare(right.created_at);
  if (createdCompare !== 0) {
    return createdCompare;
  }

  return left.id.localeCompare(right.id);
}

function compareFreeformEntries(left: GlossEntry, right: GlossEntry): number {
  const createdCompare = left.created_at.localeCompare(right.created_at);
  if (createdCompare !== 0) {
    return createdCompare;
  }

  return left.id.localeCompare(right.id);
}

function countBySeverity(entries: GlossEntry[]): Record<Severity, number> {
  return entries.reduce<Record<Severity, number>>(
    (counts, entry) => {
      counts[entry.severity] += 1;
      return counts;
    },
    {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
  );
}

function formatOldestDate(entries: GlossEntry[]): string {
  if (entries.length === 0) {
    return "n/a";
  }

  return entries
    .map((entry) => entry.created_at)
    .sort(compareIsoDates)[0]
    .slice(0, 10);
}

function formatLatestDate(entries: GlossEntry[]): string {
  if (entries.length === 0) {
    return "n/a";
  }

  return entries
    .map((entry) => entry.created_at)
    .sort(compareIsoDates)
    .at(-1)!
    .slice(0, 10);
}

function renderStructuredEntry(entry: GlossEntry & { location: GlossLocation }): string {
  const parts = [
    `### \`${formatLocation(entry.location)}\` · ${entry.id}`,
    `> ${entry.suggestion.body}`,
    `— *${entry.suggestion.author}* on [PR #${entry.pr.number}](${entry.pr.url}) · deferred by @${entry.deferred_by} · ${entry.created_at.slice(0, 10)}`,
  ];

  if (entry.note !== null) {
    parts.push(`> **Note:** ${entry.note}`);
  }

  if (entry.tags.length > 0) {
    parts.push(`> **Tags:** ${entry.tags.join(", ")}`);
  }

  return parts.join("\n");
}

function renderFreeformEntry(entry: GlossEntry): string {
  const parts = [
    `- **${entry.id}** · "${entry.suggestion.body}"`,
    `  — *${entry.suggestion.author}* on [PR #${entry.pr.number}](${entry.pr.url}) · deferred by @${entry.deferred_by} · ${entry.created_at.slice(0, 10)}`,
  ];

  if (entry.note !== null) {
    parts.push(`  > **Note:** ${entry.note}`);
  }

  if (entry.tags.length > 0) {
    parts.push(`  > **Tags:** ${entry.tags.join(", ")}`);
  }

  return parts.join("\n");
}

function formatLocation(location: GlossLocation): string {
  if (location.start_line === location.end_line) {
    return `${location.path}:${location.start_line}`;
  }

  return `${location.path}:${location.start_line}-${location.end_line}`;
}

function capitalize(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}

function compareIsoDates(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}

export function writeGlossMdFiles(paths: {
  glosslogPath?: string;
  outputPath?: string;
} = {}): void {
  const glosslogPath = paths.glosslogPath ?? GLOSSLOG_PATH;
  const outputPath = paths.outputPath ?? OUTPUT_PATH;
  const glosslogContent = readFileSync(glosslogPath, "utf-8");
  const markdown = generateGlossMd(glosslogContent);

  writeFileSync(outputPath, markdown, "utf-8");
}

function main(): void {
  try {
    writeGlossMdFiles();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error while generating GLOSS.md.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
