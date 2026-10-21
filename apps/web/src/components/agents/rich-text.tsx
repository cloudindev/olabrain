import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe Markdown for agent replies: paragraphs, bullet and numbered lists,
 * **bold**, *italic* and `code`. Builds React nodes (never HTML), so model output
 * can't inject markup.
 */
export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(
        <p key={blocks.length}>
          {paragraph.map((line, i) => (
            <Fragment key={i}>
              {i > 0 ? <br /> : null}
              {inline(line)}
            </Fragment>
          ))}
        </p>,
      );
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      const Tag = list.ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={blocks.length} className={list.ordered ? "list-decimal pl-5" : "list-disc pl-5"}>
          {list.items.map((item, i) => (
            <li key={i} className="pl-1 marker:text-ink-3">
              {inline(item)}
            </li>
          ))}
        </Tag>,
      );
      list = null;
    }
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line.replace(/^#{1,6}\s+/, ""));
    }
  }
  flushParagraph();
  flushList();
  return <div className="flex flex-col gap-2">{blocks}</div>;
}

/** **bold**, *italic*, `code`, [links](https://…) and bare https:// URLs. */
export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re =
    /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+|\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const md = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
    if (md || /^https?:\/\//.test(token)) {
      const href = md ? md[2]! : token.replace(/[.,;:!?]+$/, "");
      const label = md ? md[1] : href;
      out.push(
        <a
          key={m.index}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium underline decoration-1 underline-offset-2 hover:opacity-80"
        >
          {label}
        </a>,
      );
      // Punctuation trimmed from a bare URL stays as text.
      if (!md && href.length < token.length) out.push(token.slice(href.length));
    } else if (token.startsWith("**"))
      out.push(<strong key={m.index}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`"))
      out.push(
        <code key={m.index} className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    else out.push(<em key={m.index}>{token.slice(1, -1)}</em>);
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
