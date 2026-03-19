/**
 * X-specific format conversion using AST-based parsing.
 *
 * X DMs support very limited formatting — messages are essentially plain text.
 * The converter mostly passes through text content unchanged.
 */

import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  type Content,
  isTableNode,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
  tableToAscii,
  walkAst,
} from "chat";

export class XFormatConverter extends BaseFormatConverter {
  /**
   * Convert an AST to plain text suitable for X DMs.
   *
   * Strips formatting that X doesn't support, converting headings to
   * plain text and tables to ASCII art.
   */
  fromAst(ast: Root): string {
    const transformed = walkAst(structuredClone(ast), (node: Content) => {
      // Headings -> plain paragraph (X doesn't support heading formatting)
      if (node.type === "heading") {
        const heading = node as Content & { children: Content[] };
        return {
          type: "paragraph",
          children: heading.children.flatMap((child) =>
            child.type === "strong"
              ? (child as Content & { children: Content[] }).children
              : [child]
          ),
        } as Content;
      }
      // Thematic breaks -> text separator
      if (node.type === "thematicBreak") {
        return {
          type: "paragraph",
          children: [{ type: "text", value: "---" }],
        } as Content;
      }
      // Tables -> code blocks with ASCII art
      if (isTableNode(node)) {
        return {
          type: "code" as const,
          value: tableToAscii(node),
          lang: undefined,
        } as Content;
      }
      return node;
    });

    // Stringify to markdown then strip formatting markers
    const markdown = stringifyMarkdown(transformed, {
      emphasis: "_",
      bullet: "-",
    }).trim();

    return this.stripFormatting(markdown);
  }

  /**
   * Parse plain text into an AST.
   *
   * Since X DMs are plain text, this simply parses the text as markdown
   * which handles paragraph splitting.
   */
  toAst(text: string): Root {
    return parseMarkdown(text);
  }

  /**
   * Render a postable message to an X-compatible plain text string.
   */
  override renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return message;
    }
    if ("raw" in message) {
      return message.raw;
    }
    if ("markdown" in message) {
      return this.fromMarkdown(message.markdown);
    }
    if ("ast" in message) {
      return this.fromAst(message.ast);
    }
    return super.renderPostable(message);
  }

  /**
   * Strip markdown formatting markers for plain text output.
   * X DMs don't render bold, italic, or strikethrough.
   */
  private stripFormatting(text: string): string {
    let result = text;
    // Strip **bold** -> bold
    result = result.replace(/\*\*(.+?)\*\*/g, "$1");
    // Strip *italic* -> italic
    result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
    // Strip _italic_ -> italic
    result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "$1");
    // Strip ~~strikethrough~~ -> strikethrough
    result = result.replace(/~~(.+?)~~/g, "$1");
    return result;
  }
}
