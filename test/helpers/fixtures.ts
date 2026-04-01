import { readFileSync } from "node:fs";
import path from "node:path";

const FIXTURE_ROOT = path.resolve(__dirname, "..", "fixtures");
const PAYLOAD_FIXTURES = {
  "issue_comment.created": path.join("payloads", "issue_comment.created.json"),
  "pull_request.data": path.join("payloads", "pull_request.data.json"),
  "pull_request_review_comment.created": path.join(
    "payloads",
    "pull_request_review_comment.created.json",
  ),
  "review_comment.data": path.join("payloads", "review_comment.data.json"),
} as const;
const GLOSSLOG_FIXTURES = {
  "metadata-only": path.join("glosslog", "metadata-only.jsonl"),
} as const;

type PayloadFixtureName = keyof typeof PAYLOAD_FIXTURES;
type GlosslogFixtureName = keyof typeof GLOSSLOG_FIXTURES;

export function loadPayloadFixture<T>(name: PayloadFixtureName): T {
  return readJsonFixture<T>(PAYLOAD_FIXTURES[name]);
}

export function loadGlosslogFixture(name: GlosslogFixtureName): string {
  return readFixture(GLOSSLOG_FIXTURES[name]);
}

export function cloneFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readJsonFixture<T>(relativePath: string): T {
  return cloneFixture(JSON.parse(readFixture(relativePath)) as T);
}

function readFixture(relativePath: string): string {
  return readFileSync(path.join(FIXTURE_ROOT, relativePath), "utf-8").replace(
    /\r\n/g,
    "\n",
  );
}
