import { describe, expect, it } from "vitest";
import { XFormatConverter } from "./markdown";

describe("XFormatConverter", () => {
  const converter = new XFormatConverter();

  describe("toAst", () => {
    it("should parse plain text", () => {
      const ast = converter.toAst("Hello world");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    });

    it("should parse multiple paragraphs", () => {
      const ast = converter.toAst("First paragraph\n\nSecond paragraph");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBe(2);
    });

    it("should parse lists", () => {
      const ast = converter.toAst("- item 1\n- item 2\n- item 3");
      expect(ast.type).toBe("root");
    });
  });

  describe("fromAst", () => {
    it("should stringify a simple AST to plain text", () => {
      const ast = converter.toAst("Hello world");
      const result = converter.fromAst(ast);
      expect(result).toContain("Hello world");
    });

    it("should strip bold formatting", () => {
      const ast = converter.toAst("**bold text**");
      const result = converter.fromAst(ast);
      expect(result).toContain("bold text");
      expect(result).not.toContain("**");
    });

    it("should strip italic formatting", () => {
      const ast = converter.toAst("_italic text_");
      const result = converter.fromAst(ast);
      expect(result).toContain("italic text");
    });

    it("should strip strikethrough formatting", () => {
      const ast = converter.toAst("~~strikethrough~~");
      const result = converter.fromAst(ast);
      expect(result).toContain("strikethrough");
      expect(result).not.toContain("~~");
    });

    it("should convert headings to plain text", () => {
      const ast = converter.toAst("# Main heading");
      const result = converter.fromAst(ast);
      expect(result).toContain("Main heading");
      expect(result).not.toContain("#");
    });

    it("should convert thematic breaks to text separator", () => {
      const ast = converter.toAst("above\n\n---\n\nbelow");
      const result = converter.fromAst(ast);
      expect(result).toContain("---");
      expect(result).toContain("above");
      expect(result).toContain("below");
    });

    it("should convert tables to code blocks", () => {
      const ast = converter.toAst("| A | B |\n| --- | --- |\n| 1 | 2 |");
      const result = converter.fromAst(ast);
      expect(result).toContain("```");
    });
  });

  describe("renderPostable", () => {
    it("should render a plain string", () => {
      const result = converter.renderPostable("Hello world");
      expect(result).toBe("Hello world");
    });

    it("should render a raw message", () => {
      const result = converter.renderPostable({ raw: "raw content" });
      expect(result).toBe("raw content");
    });

    it("should render a markdown message as plain text", () => {
      const result = converter.renderPostable({
        markdown: "**bold** and _italic_",
      });
      expect(result).toContain("bold");
      expect(result).toContain("italic");
      expect(result).not.toContain("**");
    });

    it("should render an AST message", () => {
      const ast = converter.toAst("Hello from AST");
      const result = converter.renderPostable({ ast });
      expect(result).toContain("Hello from AST");
    });
  });

  describe("roundtrip", () => {
    it("should preserve text content through toAst -> fromAst", () => {
      const original = "Hello world, this is plain text";
      const ast = converter.toAst(original);
      const result = converter.fromAst(ast);
      expect(result).toContain("Hello world, this is plain text");
    });

    it("should preserve multi-paragraph text content", () => {
      const original = "First paragraph\n\nSecond paragraph";
      const ast = converter.toAst(original);
      const result = converter.fromAst(ast);
      expect(result).toContain("First paragraph");
      expect(result).toContain("Second paragraph");
    });
  });
});
