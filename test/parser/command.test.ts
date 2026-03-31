import { describe, expect, it } from "vitest";
import { parseCommand } from "../../src/parser/command";

describe("parseCommand", () => {
  describe("detection", () => {
    it("detects @gloss track at start of line", () => {
      const result = parseCommand("@gloss track");
      expect(result).not.toBeNull();
    });

    it("detects case-insensitive", () => {
      const result = parseCommand("@Gloss Track");
      expect(result).not.toBeNull();
    });

    it("detects with leading whitespace", () => {
      const result = parseCommand("  @gloss track");
      expect(result).not.toBeNull();
    });

    it("detects on second line of multiline comment", () => {
      const result = parseCommand("I agree\n@gloss track severity:high");
      expect(result).not.toBeNull();
      expect(result?.severity).toBe("high");
    });

    it("returns null for mid-sentence", () => {
      const result = parseCommand("I agree with this, @gloss track");
      expect(result).toBeNull();
    });

    it("returns null for blockquoted", () => {
      const result = parseCommand("> @gloss track");
      expect(result).toBeNull();
    });

    it("returns null for fenced code block", () => {
      const result = parseCommand("```\n@gloss track\n```");
      expect(result).toBeNull();
    });

    it("returns null for inline code", () => {
      const result = parseCommand("Use `@gloss track` to defer");
      expect(result).toBeNull();
    });

    it("returns null when inline code appears before the command", () => {
      const result = parseCommand("`example` @gloss track tag:v1");
      expect(result).toBeNull();
    });

    it("returns null when no command present", () => {
      const result = parseCommand("Just a normal comment");
      expect(result).toBeNull();
    });
  });

  describe("overrides", () => {
    it("parses severity override", () => {
      const result = parseCommand("@gloss track severity:high");
      expect(result?.severity).toBe("high");
    });

    it("parses single tag", () => {
      const result = parseCommand("@gloss track tag:v2");
      expect(result?.tags).toEqual(["v2"]);
    });

    it("parses multiple tags", () => {
      const result = parseCommand("@gloss track tag:v2 tag:backlog");
      expect(result?.tags).toEqual(["v2", "backlog"]);
    });

    it("parses severity and tags together", () => {
      const result = parseCommand("@gloss track severity:critical tag:security");
      expect(result?.severity).toBe("critical");
      expect(result?.tags).toEqual(["security"]);
    });

    it("handles tag with colons in value", () => {
      const result = parseCommand("@gloss track tag:v2:experimental");
      expect(result?.tags).toEqual(["v2:experimental"]);
    });
  });

  describe("note extraction", () => {
    it("captures remaining text as note", () => {
      const result = parseCommand("@gloss track this needs fixing soon");
      expect(result?.note).toBe("this needs fixing soon");
    });

    it("captures note after overrides", () => {
      const result = parseCommand("@gloss track severity:high fix before launch");
      expect(result?.severity).toBe("high");
      expect(result?.note).toBe("fix before launch");
    });

    it("returns null note when no extra text", () => {
      const result = parseCommand("@gloss track");
      expect(result?.note).toBeNull();
    });

    it("returns null note when only overrides", () => {
      const result = parseCommand("@gloss track severity:medium tag:v2");
      expect(result?.note).toBeNull();
    });
  });

  describe("unknown keys", () => {
    it("treats unknown key:value as note text", () => {
      const result = parseCommand("@gloss track foo:bar");
      expect(result?.note).toBe("foo:bar");
      expect(result?.tags).toEqual([]);
    });

    it("treats foo:bar pattern in normal text as note", () => {
      const result = parseCommand("@gloss track fix the foo:bar pattern");
      expect(result?.note).toBe("fix the foo:bar pattern");
    });
  });

  describe("invalid severity", () => {
    it("flags invalid severity and stores in note", () => {
      const result = parseCommand("@gloss track severity:hihg");

      expect(result?.severity).toBeNull();
      expect(result?.invalidOverrides).toEqual([
        { key: "severity", value: "hihg" },
      ]);
      expect(result?.note).toBe("severity:hihg");
    });

    it("flags invalid severity alongside valid tag", () => {
      const result = parseCommand("@gloss track severity:hihg tag:v2");

      expect(result?.severity).toBeNull();
      expect(result?.tags).toEqual(["v2"]);
      expect(result?.invalidOverrides).toEqual([
        { key: "severity", value: "hihg" },
      ]);
    });
  });

  describe("defaults", () => {
    it("returns null severity when not specified", () => {
      const result = parseCommand("@gloss track");

      expect(result?.severity).toBeNull();
      expect(result?.tags).toEqual([]);
      expect(result?.note).toBeNull();
      expect(result?.invalidOverrides).toEqual([]);
    });
  });
});
