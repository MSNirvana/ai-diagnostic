import type { ReactNode } from "react";

type MessageBlock =
  | { type: "heading"; text: string; detail?: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

function pushParagraphs(blocks: MessageBlock[], text: string) {
  text
    .split(/([。！？!?])/)
    .reduce<string[]>((acc, part, index, arr) => {
      if (index % 2 === 0) {
        const punct = arr[index + 1] ?? "";
        const sentence = `${part}${punct}`.trim();
        if (sentence) acc.push(sentence);
      }
      return acc;
    }, [])
    .forEach((sentence) => blocks.push({ type: "paragraph", text: sentence }));
}

function formatBlocks(content: string): MessageBlock[] {
  const prepared = content
    .replace(/\r\n/g, "\n")
    .replace(/\s+([0-9]+[.、)])\s+/g, "\n$1 ")
    .replace(/\s+([-*•])\s+/g, "\n$1 ")
    .trim();
  if (!prepared) return [];
  const blocks: MessageBlock[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length) {
      blocks.push({ type: "list", items: listItems });
      listItems = [];
    }
  };

  prepared.split(/\n+/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    const listMatch = line.match(/^(?:[-*•]|[0-9]+[.、)])\s*(.+)$/);
    if (listMatch?.[1]) {
      listItems.push(listMatch[1].trim());
      return;
    }

    flushList();

    const markdownHeading = line.match(/^#{1,4}\s+(.+)$/);
    if (markdownHeading?.[1]) {
      blocks.push({ type: "heading", text: markdownHeading[1].trim() });
      return;
    }

    const colonHeading = line.match(/^([^：:]{2,14})[：:]\s*(.+)$/);
    if (colonHeading?.[1] && colonHeading?.[2] && !line.includes("http")) {
      blocks.push({
        type: "heading",
        text: colonHeading[1].trim(),
        detail: colonHeading[2].trim(),
      });
      return;
    }

    pushParagraphs(blocks, line);
  });

  flushList();
  return blocks;
}

function renderInlineText(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`)/g;
  let cursor = 0;
  let index = 0;

  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    const start = match.index ?? 0;
    if (start > cursor) {
      nodes.push(text.slice(cursor, start));
    }

    if (value.startsWith("`")) {
      nodes.push(<code key={`${keyPrefix}-code-${index}`}>{value.slice(1, -1)}</code>);
    } else {
      nodes.push(<strong key={`${keyPrefix}-strong-${index}`}>{value.slice(2, -2)}</strong>);
    }

    cursor = start + value.length;
    index += 1;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes.length ? nodes : [text];
}

export function renderMessageBlocks(content: string, keyPrefix: string) {
  const blocks = formatBlocks(content);
  if (!blocks.length) return <p>{content}</p>;

  return blocks.map((block, i) => {
    if (block.type === "heading") {
      return (
        <div key={`${keyPrefix}-${i}`} className="freechat-message-section">
          <h4>{renderInlineText(block.text, `${keyPrefix}-${i}-heading`)}</h4>
          {block.detail && <p>{renderInlineText(block.detail, `${keyPrefix}-${i}-detail`)}</p>}
        </div>
      );
    }
    if (block.type === "list") {
      return (
        <ul key={`${keyPrefix}-${i}`} className="freechat-message-list">
          {block.items.map((item, itemIndex) => (
            <li key={`${keyPrefix}-${i}-${itemIndex}`}>{renderInlineText(item, `${keyPrefix}-${i}-${itemIndex}`)}</li>
          ))}
        </ul>
      );
    }
    return <p key={`${keyPrefix}-${i}`}>{renderInlineText(block.text, `${keyPrefix}-${i}`)}</p>;
  });
}
