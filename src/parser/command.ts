import { isValidSeverity, type Severity } from "../schema/entry";

export interface InvalidOverride {
  key: string;
  value: string;
}

export interface ParseResult {
  severity: Severity | null;
  tags: string[];
  note: string | null;
  invalidOverrides: InvalidOverride[];
}

const COMMAND_PATTERN = /^\s*@gloss\s+track\b/i;

export function parseCommand(body: string): ParseResult | null {
  const lines = body.split("\n");
  let insideFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const isFenceLine = /^\s*```/.test(line);

    if (isFenceLine) {
      insideFence = !insideFence;
      continue;
    }

    if (insideFence || /^\s*>/.test(line)) {
      continue;
    }

    const match = COMMAND_PATTERN.exec(line);

    if (!match) {
      continue;
    }

    const remainder = line.slice(match[0].length).trim();

    return parseOverrides(remainder);
  }

  return null;
}

function parseOverrides(text: string): ParseResult {
  const result: ParseResult = {
    severity: null,
    tags: [],
    note: null,
    invalidOverrides: [],
  };

  if (!text) {
    return result;
  }

  const noteTokens: string[] = [];

  for (const token of text.split(/\s+/)) {
    const separatorIndex = token.indexOf(":");

    if (separatorIndex > 0) {
      const key = token.slice(0, separatorIndex);
      const value = token.slice(separatorIndex + 1);

      if (key === "severity" && value) {
        if (isValidSeverity(value)) {
          result.severity = value;
        } else {
          result.invalidOverrides.push({ key, value });
          noteTokens.push(token);
        }

        continue;
      }

      if (key === "tag" && value) {
        result.tags.push(value);
        continue;
      }
    }

    noteTokens.push(token);
  }

  result.note = noteTokens.length > 0 ? noteTokens.join(" ") : null;

  return result;
}
