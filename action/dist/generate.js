"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateGlossMd = generateGlossMd;
exports.writeGlossMdFiles = writeGlossMdFiles;
const node_fs_1 = require("node:fs");
const SEVERITIES = ["critical", "high", "medium", "low"];
const GLOSSLOG_PATH = ".glosslog";
const OUTPUT_PATH = "GLOSS.md";
function generateGlossMd(glosslogContent) {
    const entries = parseEntries(glosslogContent);
    const structured = entries
        .filter((entry) => {
        return entry.type === "structured" && entry.location !== null;
    })
        .sort(compareStructuredEntries);
    const freeform = entries
        .filter((entry) => {
        return entry.type === "freeform" && entry.location === null;
    })
        .sort(compareFreeformEntries);
    const counts = countBySeverity(entries);
    const oldest = formatOldestDate(entries);
    const latest = formatLatestDate(entries);
    const sections = [
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
        sections.push("These entries are included in the summary counts above but are listed separately because they have no file/line context.", "");
        for (const entry of freeform) {
            sections.push(renderFreeformEntry(entry), "");
        }
    }
    sections.push("", "---", "", `*Last updated from .glosslog snapshot: ${latest}*`, "");
    return sections.join("\n");
}
function parseEntries(glosslogContent) {
    return glosslogContent
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .flatMap((line) => {
        const parsed = parseLine(line);
        return parsed === null ? [] : [parsed];
    });
}
function parseLine(line) {
    let value;
    try {
        value = JSON.parse(line);
    }
    catch {
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
function isValidEntry(value) {
    if (typeof value.id !== "string" ||
        typeof value.version !== "number" ||
        value.version !== 1 ||
        !isValidType(value.type) ||
        typeof value.repo !== "string" ||
        typeof value.created_at !== "string" ||
        Number.isNaN(Date.parse(value.created_at)) ||
        value.source !== "github-pr" ||
        !isValidSeverity(value.severity) ||
        typeof value.deferred_by !== "string" ||
        typeof value.status !== "string") {
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
function toGlossEntry(value) {
    const suggestion = value.suggestion;
    const pr = value.pr;
    const location = value.location === null ? null : value.location;
    return {
        _type: "entry",
        id: value.id,
        version: value.version,
        type: value.type,
        repo: value.repo,
        created_at: value.created_at,
        source: "github-pr",
        suggestion: {
            body: suggestion.body,
            author: suggestion.author,
            author_type: suggestion.author_type,
            url: suggestion.url,
        },
        location: location === null
            ? null
            : {
                path: location.path,
                start_line: location.start_line,
                end_line: location.end_line,
                original_commit_sha: location.original_commit_sha,
            },
        pr: {
            number: pr.number,
            title: pr.title,
            url: pr.url,
        },
        deferred_by: value.deferred_by,
        severity: value.severity,
        tags: value.tags,
        note: value.note,
        status: "open",
    };
}
function isValidType(value) {
    return value === "structured" || value === "freeform";
}
function isValidSeverity(value) {
    return typeof value === "string" && SEVERITIES.includes(value);
}
function isSuggestion(value) {
    return (isRecord(value) &&
        typeof value.body === "string" &&
        typeof value.author === "string" &&
        isAuthorType(value.author_type) &&
        typeof value.url === "string");
}
function isPullRequest(value) {
    return (isRecord(value) &&
        typeof value.number === "number" &&
        typeof value.title === "string" &&
        typeof value.url === "string");
}
function isLocation(value) {
    return (isRecord(value) &&
        typeof value.path === "string" &&
        typeof value.start_line === "number" &&
        typeof value.end_line === "number" &&
        typeof value.original_commit_sha === "string");
}
function isAuthorType(value) {
    return value === "bot" || value === "human";
}
function isTags(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function compareStructuredEntries(left, right) {
    const pathCompare = left.location.path.localeCompare(right.location.path);
    if (pathCompare !== 0) {
        return pathCompare;
    }
    const startCompare = left.location.start_line - right.location.start_line;
    if (startCompare !== 0) {
        return startCompare;
    }
    const createdCompare = compareIsoDates(left.created_at, right.created_at);
    if (createdCompare !== 0) {
        return createdCompare;
    }
    return left.id.localeCompare(right.id);
}
function compareFreeformEntries(left, right) {
    const createdCompare = compareIsoDates(left.created_at, right.created_at);
    if (createdCompare !== 0) {
        return createdCompare;
    }
    return left.id.localeCompare(right.id);
}
function countBySeverity(entries) {
    return entries.reduce((counts, entry) => {
        counts[entry.severity] += 1;
        return counts;
    }, {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
    });
}
function formatOldestDate(entries) {
    if (entries.length === 0) {
        return "n/a";
    }
    return entries
        .map((entry) => entry.created_at)
        .sort(compareIsoDates)[0]
        .slice(0, 10);
}
function formatLatestDate(entries) {
    if (entries.length === 0) {
        return "n/a";
    }
    return entries
        .map((entry) => entry.created_at)
        .sort(compareIsoDates)
        .at(-1)
        .slice(0, 10);
}
function renderStructuredEntry(entry) {
    const parts = [
        `### \`${formatLocation(entry.location)}\` · ${entry.id}`,
        formatBlockQuote(entry.suggestion.body),
        `— *${entry.suggestion.author}* on [PR #${entry.pr.number}](${entry.pr.url}) · deferred by @${entry.deferred_by} · ${entry.created_at.slice(0, 10)}`,
    ];
    if (entry.note !== null) {
        parts.push(formatPrefixedMultiline(entry.note, "> **Note:** ", "> "));
    }
    if (entry.tags.length > 0) {
        parts.push(`> **Tags:** ${entry.tags.join(", ")}`);
    }
    return parts.join("\n");
}
function renderFreeformEntry(entry) {
    const parts = [
        formatFreeformBody(entry.id, entry.suggestion.body),
        `  — *${entry.suggestion.author}* on [PR #${entry.pr.number}](${entry.pr.url}) · deferred by @${entry.deferred_by} · ${entry.created_at.slice(0, 10)}`,
    ];
    if (entry.note !== null) {
        parts.push(formatPrefixedMultiline(entry.note, "  > **Note:** ", "  > "));
    }
    if (entry.tags.length > 0) {
        parts.push(`  > **Tags:** ${entry.tags.join(", ")}`);
    }
    return parts.join("\n");
}
function formatLocation(location) {
    if (location.start_line === location.end_line) {
        return `${location.path}:${location.start_line}`;
    }
    return `${location.path}:${location.start_line}-${location.end_line}`;
}
function capitalize(value) {
    return value[0].toUpperCase() + value.slice(1);
}
function compareIsoDates(left, right) {
    return Date.parse(left) - Date.parse(right);
}
function formatBlockQuote(value) {
    return formatPrefixedMultiline(value, "> ", "> ");
}
function formatFreeformBody(id, value) {
    return formatPrefixedMultiline(value, `- **${id}** · "`, "  ", '"');
}
function formatPrefixedMultiline(value, firstLinePrefix, nextLinePrefix, suffix = "") {
    const [firstLine = "", ...rest] = normalizeMultiline(value);
    const lines = [`${firstLinePrefix}${firstLine}`];
    for (const line of rest) {
        lines.push(`${nextLinePrefix}${line}`);
    }
    lines[lines.length - 1] += suffix;
    return lines.join("\n");
}
function normalizeMultiline(value) {
    return value.replace(/\r\n/g, "\n").split("\n");
}
function writeGlossMdFiles(paths = {}) {
    const glosslogPath = paths.glosslogPath ?? GLOSSLOG_PATH;
    const outputPath = paths.outputPath ?? OUTPUT_PATH;
    const glosslogContent = (0, node_fs_1.readFileSync)(glosslogPath, "utf-8");
    const markdown = generateGlossMd(glosslogContent);
    (0, node_fs_1.writeFileSync)(outputPath, markdown, "utf-8");
}
function main() {
    try {
        writeGlossMdFiles();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error while generating GLOSS.md.";
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
    }
}
if (require.main === module) {
    main();
}
