import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateGlossMd, writeGlossMdFiles } from "../../action/generate";
import { loadGlosslogFixture } from "../helpers/fixtures";

function indexOfOrThrow(value: string, search: string): number {
  const index = value.indexOf(search);

  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

describe("generateGlossMd", () => {
  it("renders a deterministic empty backlog summary", () => {
    const markdown = generateGlossMd(loadGlosslogFixture("metadata-only"));

    expect(markdown).toContain("# Tech Debt Tracker");
    expect(markdown).toContain(
      "**0 open items** · 0 critical · 0 high · 0 medium · 0 low · oldest: n/a",
    );
    expect(markdown).not.toContain("## Critical");
    expect(markdown).not.toContain("## Freeform");
  });

  it("renders structured entries with location, note, and tags", () => {
    const markdown = generateGlossMd(loadGlosslogFixture("single-structured"));

    expect(markdown).toContain(
      "**1 open items** · 0 critical · 1 high · 0 medium · 0 low · oldest: 2026-04-01",
    );
    expect(markdown).toContain("## High (1)");
    expect(markdown).toContain("### `src/cache.ts:10-12` · g_single01");
    expect(markdown).toContain("> Use a Map instead of an object for cache storage.");
    expect(markdown).toContain(
      "— *reviewer* on [PR #7](https://github.com/octo-org/example-repo/pull/7) · deferred by @mbatrakov · 2026-04-01",
    );
    expect(markdown).toContain("> **Note:** ship v1 first");
    expect(markdown).toContain("> **Tags:** perf, v2");
  });

  it("orders structured sections and entries deterministically", () => {
    const markdown = generateGlossMd(loadGlosslogFixture("mixed-severity"));

    const criticalIndex = indexOfOrThrow(markdown, "## Critical (1)");
    const highIndex = indexOfOrThrow(markdown, "## High (2)");
    const mediumIndex = indexOfOrThrow(markdown, "## Medium (1)");

    expect(criticalIndex).toBeLessThan(highIndex);
    expect(highIndex).toBeLessThan(mediumIndex);

    const highFirst = indexOfOrThrow(markdown, "### `src/auth.ts:10` · g_high001");
    const highSecond = indexOfOrThrow(markdown, "### `src/auth.ts:20` · g_high002");

    expect(highFirst).toBeLessThan(highSecond);
    expect(markdown).not.toContain("g_closed01");
  });

  it("renders freeform entries in a separate section after structured entries", () => {
    const markdown = generateGlossMd(loadGlosslogFixture("with-freeform"));

    const mediumIndex = indexOfOrThrow(markdown, "## Medium (1)");
    const freeformIndex = indexOfOrThrow(markdown, "## Freeform (2)");

    expect(mediumIndex).toBeLessThan(freeformIndex);
    expect(markdown).toContain(
      "**3 open items** · 0 critical · 1 high · 1 medium · 1 low · oldest: 2026-04-01",
    );
    expect(markdown).toContain(
      "These entries are included in the summary counts above but are listed separately because they have no file/line context.",
    );
    expect(markdown).toContain('- **g_free001** · "Document deployment rollback steps."');
    expect(markdown).toContain(
      '- **g_free002** · "Refactor the whole auth flow before adding SSO."',
    );
    expect(markdown).toContain("> **Note:** too risky right now");
    expect(markdown).toContain("> **Tags:** auth");
  });

  it("skips malformed and invalid entries instead of failing generation", () => {
    const markdown = generateGlossMd(loadGlosslogFixture("with-invalid-lines"));

    expect(markdown).toContain(
      "**1 open items** · 0 critical · 0 high · 0 medium · 1 low · oldest: 2026-04-01",
    );
    expect(markdown).toContain("g_valid001");
    expect(markdown).not.toContain("g_badsev01");
    expect(markdown).not.toContain("g_baddate1");
    expect(markdown).not.toContain("g_missing01");
    expect(markdown).not.toContain("this is not json");
  });

  it("skips entries with unsupported schema versions", () => {
    const markdown = generateGlossMd(`{"_type":"glosslog","version":1,"repo":"octo-org/example-repo","initialized_at":"2026-04-01T09:00:00Z"}
{"_type":"entry","id":"g_supported01","version":1,"type":"structured","repo":"octo-org/example-repo","created_at":"2026-04-01T10:00:00Z","source":"github-pr","suggestion":{"body":"Supported schema entry","author":"reviewer","author_type":"human","url":"https://github.com/octo-org/example-repo/pull/22#discussion_r1"},"location":{"path":"src/version.ts","start_line":1,"end_line":1,"original_commit_sha":"ver001"},"pr":{"number":22,"title":"Version guard","url":"https://github.com/octo-org/example-repo/pull/22"},"deferred_by":"mbatrakov","severity":"medium","tags":[],"note":null,"status":"open"}
{"_type":"entry","id":"g_future01","version":2,"type":"structured","repo":"octo-org/example-repo","created_at":"2026-04-01T11:00:00Z","source":"github-pr","suggestion":{"body":"Future schema entry","author":"reviewer","author_type":"human","url":"https://github.com/octo-org/example-repo/pull/22#discussion_r2"},"location":{"path":"src/version.ts","start_line":2,"end_line":2,"original_commit_sha":"ver002"},"pr":{"number":22,"title":"Version guard","url":"https://github.com/octo-org/example-repo/pull/22"},"deferred_by":"mbatrakov","severity":"high","tags":[],"note":null,"status":"open"}
`);

    expect(markdown).toContain(
      "**1 open items** · 0 critical · 0 high · 1 medium · 0 low · oldest: 2026-04-01",
    );
    expect(markdown).toContain("g_supported01");
    expect(markdown).not.toContain("g_future01");
  });

  it("keeps multiline suggestion and note content inside markdown containers", () => {
    const markdown = generateGlossMd(`{"_type":"glosslog","version":1,"repo":"octo-org/example-repo","initialized_at":"2026-04-01T09:00:00Z"}
{"_type":"entry","id":"g_multi001","version":1,"type":"structured","repo":"octo-org/example-repo","created_at":"2026-04-01T10:00:00Z","source":"github-pr","suggestion":{"body":"Line one\\n### escaped heading","author":"reviewer","author_type":"human","url":"https://github.com/octo-org/example-repo/pull/19#discussion_r1"},"location":{"path":"src/multi.ts","start_line":3,"end_line":4,"original_commit_sha":"abc999"},"pr":{"number":19,"title":"Multiline","url":"https://github.com/octo-org/example-repo/pull/19"},"deferred_by":"mbatrakov","severity":"medium","tags":[],"note":"first note line\\n- still quoted","status":"open"}
{"_type":"entry","id":"g_multi002","version":1,"type":"freeform","repo":"octo-org/example-repo","created_at":"2026-04-01T11:00:00Z","source":"github-pr","suggestion":{"body":"Freeform line one\\nsecond line","author":"teammate","author_type":"human","url":"https://github.com/octo-org/example-repo/pull/20#issuecomment-1"},"location":null,"pr":{"number":20,"title":"Freeform multiline","url":"https://github.com/octo-org/example-repo/pull/20"},"deferred_by":"mbatrakov","severity":"high","tags":[],"note":"note line one\\nnote line two","status":"open"}
`);

    expect(markdown).toContain("> Line one\n> ### escaped heading");
    expect(markdown).toContain("> **Note:** first note line\n> - still quoted");
    expect(markdown).toContain('- **g_multi002** · "Freeform line one\n  second line"');
    expect(markdown).toContain("  > **Note:** note line one\n  > note line two");
  });

  it("orders entries by actual timestamp when created_at formats sort lexically differently", () => {
    const markdown = generateGlossMd(`{"_type":"glosslog","version":1,"repo":"octo-org/example-repo","initialized_at":"2026-04-01T09:00:00Z"}
{"_type":"entry","id":"g_time002","version":1,"type":"structured","repo":"octo-org/example-repo","created_at":"2026-04-01T00:30:00+02:00","source":"github-pr","suggestion":{"body":"Later lexical, earlier actual time","author":"reviewer","author_type":"human","url":"https://github.com/octo-org/example-repo/pull/21#discussion_r2"},"location":{"path":"src/time.ts","start_line":5,"end_line":5,"original_commit_sha":"time002"},"pr":{"number":21,"title":"Time order","url":"https://github.com/octo-org/example-repo/pull/21"},"deferred_by":"mbatrakov","severity":"high","tags":[],"note":null,"status":"open"}
{"_type":"entry","id":"g_time001","version":1,"type":"structured","repo":"octo-org/example-repo","created_at":"2026-03-31T23:45:00Z","source":"github-pr","suggestion":{"body":"Earlier lexical, later actual time","author":"reviewer","author_type":"human","url":"https://github.com/octo-org/example-repo/pull/21#discussion_r1"},"location":{"path":"src/time.ts","start_line":5,"end_line":5,"original_commit_sha":"time001"},"pr":{"number":21,"title":"Time order","url":"https://github.com/octo-org/example-repo/pull/21"},"deferred_by":"mbatrakov","severity":"high","tags":[],"note":null,"status":"open"}
`);

    const first = indexOfOrThrow(markdown, "g_time002");
    const second = indexOfOrThrow(markdown, "g_time001");
    expect(first).toBeLessThan(second);
  });

  it("writes GLOSS.md from glosslog and output file paths", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "glossbot-action-"));
    const glosslogPath = path.join(tempDir, ".glosslog");
    const outputPath = path.join(tempDir, "GLOSS.md");

    try {
      writeFileSync(glosslogPath, loadGlosslogFixture("single-structured"), "utf-8");

      writeGlossMdFiles({ glosslogPath, outputPath });

      const written = readFileSync(outputPath, "utf-8");
      expect(written).toContain("# Tech Debt Tracker");
      expect(written).toContain("g_single01");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when the glosslog input file is missing", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "glossbot-action-"));
    const glosslogPath = path.join(tempDir, ".glosslog");
    const outputPath = path.join(tempDir, "GLOSS.md");

    try {
      expect(() => writeGlossMdFiles({ glosslogPath, outputPath })).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
