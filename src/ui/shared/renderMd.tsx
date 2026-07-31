import type { ReactNode } from "react";

type MdNode =
  | { type: "h1" | "h2" | "h3"; text: string }
  | { type: "li"; text: ReactNode[] }
  | { type: "p"; children: ReactNode[] }
  | { type: "code"; text: string };

function inlineNodes(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*.+?\*\*|\*.+?\*|\[.+?\]\(.+?\))/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];

    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={m.index}
          className="px-1! py-0.5! rounded bg-[#1e1e1e] text-[#e5e5e5] text-[11px]! font-mono"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={m.index} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={m.index}>{token.slice(1, -1)}</em>);
    } else {
      const link = /^\[(.+?)\]\((.+?)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a
            key={m.index}
            href={link[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#0066cc] underline underline-offset-2"
          >
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }
    last = m.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length > 0 ? nodes : [text];
}

function parseMd(src: string): MdNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: MdNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    // Code block
    if (trimmed.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      out.push({ type: "code", text: buf.join("\n") });
      i++;
      continue;
    }

    // Headings
    const h3 = /^###\s+(.+)/.exec(trimmed);
    if (h3) {
      out.push({ type: "h3", text: h3[1] });
      i++;
      continue;
    }
    const h2 = /^##\s+(.+)/.exec(trimmed);
    if (h2) {
      out.push({ type: "h2", text: h2[1] });
      i++;
      continue;
    }
    const h1 = /^#\s+(.+)/.exec(trimmed);
    if (h1) {
      out.push({ type: "h1", text: h1[1] });
      i++;
      continue;
    }

    // List items
    const li = /^[-*]\s+(.+)/.exec(trimmed);
    if (li) {
      out.push({ type: "li", text: inlineNodes(li[1]) });
      i++;
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (t === "" || /^(#{1,3}\s|```|[-*]\s)/.test(t)) break;
      paraLines.push(t);
      i++;
    }
    if (paraLines.length) {
      out.push({ type: "p", children: inlineNodes(paraLines.join(" ")) });
    }
  }

  return out;
}

export function renderMd(src: string, size: "sm" | "md" = "sm"): ReactNode[] {
  const nodes = parseMd(src);
  const s = size === "md";
  return nodes.map((n, i) => {
    switch (n.type) {
      case "h1":
        return (
          <h1 key={i} className={s ? "text-[18px]! font-bold text-[#e5e5e5] mt-5! mb-2!" : "text-[15px]! font-bold text-[#e5e5e5] mt-3! mb-1!"}>
            {n.text}
          </h1>
        );
      case "h2":
        return (
          <h2 key={i} className={s ? "text-[15px]! font-semibold text-[#ccc] mt-4! mb-1.5!" : "text-[13px]! font-semibold text-[#ccc] mt-2! mb-1!"}>
            {n.text}
          </h2>
        );
      case "h3":
        return (
          <h3 key={i} className={s ? "text-[13px]! font-semibold text-[#bbb] mt-3! mb-1!" : "text-[12px]! font-semibold text-[#bbb] mt-2! mb-0.5!"}>
            {n.text}
          </h3>
        );
      case "li":
        return (
          <li
            key={i}
            className={s
              ? "flex items-start gap-1.5! text-[12.5px]! text-[#999] leading-relaxed ml-2!"
              : "flex items-start gap-1! text-[11px]! text-[#888] leading-relaxed ml-1.5!"
            }
          >
            <span className="text-[#0066cc] shrink-0 mt-[5px]! w-1! h-1! rounded-full bg-[#0066cc]/60" />
            <span>{n.text}</span>
          </li>
        );
      case "code":
        return (
          <pre
            key={i}
            className={s
              ? "bg-[#0d0d0d] border border-[#1e1e1e] rounded-lg! p-3! my-2! overflow-x-auto text-[11.5px]! text-[#aaa] font-mono leading-relaxed"
              : "bg-[#0d0d0d] border border-[#1e1e1e] rounded! p-2! my-1! overflow-x-auto text-[10px]! text-[#999] font-mono leading-relaxed"
            }
          >
            {n.text}
          </pre>
        );
      case "p":
        return (
          <p key={i} className={s ? "text-[12.5px]! text-[#999] leading-relaxed mt-1.5! mb-1.5!" : "text-[11px]! text-[#888] leading-relaxed mt-1! mb-1!"}>
            {n.children}
          </p>
        );
    }
  });
}
