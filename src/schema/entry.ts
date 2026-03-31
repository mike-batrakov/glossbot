import { randomBytes } from "crypto";

export type Severity = "critical" | "high" | "medium" | "low";
export type EntryType = "structured" | "freeform";
export type AuthorType = "bot" | "human";

export interface GlossLocation {
  path: string;
  start_line: number;
  end_line: number;
  original_commit_sha: string;
}

export interface GlossSuggestion {
  body: string;
  author: string;
  author_type: AuthorType;
  url: string;
}

export interface GlossPr {
  number: number;
  title: string;
  url: string;
}

export interface GlossEntry {
  _type: "entry";
  id: string;
  version: number;
  type: EntryType;
  repo: string;
  created_at: string;
  source: "github-pr";
  suggestion: GlossSuggestion;
  location: GlossLocation | null;
  pr: GlossPr;
  deferred_by: string;
  severity: Severity;
  tags: string[];
  note: string | null;
  status: "open";
}

export interface GlossMetadata {
  _type: "glosslog";
  version: number;
  repo: string;
  initialized_at: string;
}

export interface CreateEntryInput {
  type: EntryType;
  repo: string;
  suggestion: GlossSuggestion;
  location: GlossLocation | null;
  pr: GlossPr;
  deferred_by: string;
  severity: Severity;
  tags: string[];
  note: string | null;
}

export const SEVERITIES: readonly Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
] as const;

export function generateId(): string {
  return `g_${randomBytes(4).toString("hex")}`;
}

export function isValidSeverity(value: string): value is Severity {
  return SEVERITIES.includes(value as Severity);
}

export function createMetadataLine(repo: string): string {
  const metadata: GlossMetadata = {
    _type: "glosslog",
    version: 1,
    repo,
    initialized_at: new Date().toISOString(),
  };

  return JSON.stringify(metadata);
}

export function createEntry(input: CreateEntryInput): GlossEntry {
  return {
    _type: "entry",
    id: generateId(),
    version: 1,
    type: input.type,
    repo: input.repo,
    created_at: new Date().toISOString(),
    source: "github-pr",
    suggestion: input.suggestion,
    location: input.location,
    pr: input.pr,
    deferred_by: input.deferred_by,
    severity: input.severity,
    tags: input.tags,
    note: input.note,
    status: "open",
  };
}

export function isHttpError(error: unknown): error is { status: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  );
}
