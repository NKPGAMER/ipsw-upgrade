import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UpdateData {
  version: string;
  notes: string | string[] | null;
}

interface Progress {
  percent: number;
  transferred: string;
  total: string;
}

type Phase = "idle" | "downloading" | "ready" | "no-update";

// ── Simple markdown → JSX renderer ────────────────────────────────────────────

type MdNode =
  | { type: "h1" | "h2" | "h3"; text: string }
  | { type: "li"; text: ReactNode[] }
  | { type: "p"; children: ReactNode[] }
  | { type: "code"; text: string };

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
      i++; // skip closing ```
      continue;
    }

    // Headings
    const h3 = /^###\s+(.+)/.exec(trimmed);
    if (h3) { out.push({ type: "h3", text: h3[1] }); i++; continue; }
    const h2 = /^##\s+(.+)/.exec(trimmed);
    if (h2) { out.push({ type: "h2", text: h2[1] }); i++; continue; }
    const h1 = /^#\s+(.+)/.exec(trimmed);
    if (h1) { out.push({ type: "h1", text: h1[1] }); i++; continue; }

    // List items
    const li = /^[-*]\s+(.+)/.exec(trimmed);
    if (li) {
      out.push({ type: "li", text: inlineNodes(li[1]) });
      i++;
      continue;
    }

    // Paragraph — collect until blank line or next block element
    const paraLines: string[] = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (
        t === "" ||
        /^(#{1,3}\s|```|[-*]\s)/.test(t)
      ) break;
      paraLines.push(t);
      i++;
    }
    if (paraLines.length) {
      out.push({ type: "p", children: inlineNodes(paraLines.join(" ") ) });
    }
  }

  return out;
}

function inlineNodes(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Order: code ticks first, then bold, then italic, then links
  const re = /(`[^`]+`|\*\*.+?\*\*|\*.+?\*|\[.+?\]\(.+?\))/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];

    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code key={m.index} className="px-1! py-0.5! rounded bg-[#1e1e1e] text-[#e5e5e5] text-[12px]! font-mono">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={m.index} className="font-semibold">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={m.index}>{token.slice(1, -1)}</em>);
    } else {
      const link = /^\[(.+?)\]\((.+?)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a key={m.index} href={link[2]} target="_blank" rel="noopener noreferrer"
            className="text-[#137fec] underline underline-offset-2">
            {link[1]}
          </a>
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

function renderMd(src: string): ReactNode[] {
  const nodes = parseMd(src);
  return nodes.map((n, i) => {
    switch (n.type) {
      case "h1":
        return <h1 key={i} className="text-[18px]! font-bold text-[#e5e5e5] mt-5! mb-2!">{n.text}</h1>;
      case "h2":
        return <h2 key={i} className="text-[15px]! font-semibold text-[#ccc] mt-4! mb-1.5!">{n.text}</h2>;
      case "h3":
        return <h3 key={i} className="text-[13px]! font-semibold text-[#bbb] mt-3! mb-1!">{n.text}</h3>;
      case "li":
        return (
          <li key={i} className="flex items-start gap-1.5! text-[12.5px]! text-[#999] leading-relaxed ml-2!">
            <span className="text-[#137fec] shrink-0 mt-[5px]! w-1! h-1! rounded-full bg-[#137fec]" />
            <span>{n.text}</span>
          </li>
        );
      case "code":
        return (
          <pre key={i} className="bg-[#0d0d0d] border border-[#1e1e1e] rounded-lg! p-3! my-2! overflow-x-auto text-[11.5px]! text-[#aaa] font-mono leading-relaxed">
            {n.text}
          </pre>
        );
      case "p":
        return <p key={i} className="text-[12.5px]! text-[#999] leading-relaxed mt-1.5! mb-1.5!">{n.children}</p>;
    }
  });
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const ArrowLeftIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
    strokeLinecap="round" strokeLinejoin="round" className="w-4.25! h-4.25!">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

// ── AppUpdate ─────────────────────────────────────────────────────────────────

export default function AppUpdate() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [data, setData] = useState<UpdateData | null>(null);
  const [progress, setProgress] = useState<Progress>({ percent: 0, transferred: "0", total: "0" });
  const navigate = useNavigate();

  const notes: string | null = useMemo(() => {
    if (!data?.notes) return null;
    return Array.isArray(data.notes) ? data.notes.join("\n") : data.notes;
  }, [data]);

  useEffect(() => {
    window.updater.getStatus().then((status) => {
      if (status.version) setData({ version: status.version, notes: status.notes ?? null });
      if (status.progress) setProgress(status.progress);
      setPhase(status.phase);
    });

    const subs = [
      window.updater.onUpdateAvailable((d) => {
        setData(d);
        setPhase("downloading");
      }),
      window.updater.onUpdateProgress((p) => setProgress(p)),
      window.updater.onUpdateReady(() => setPhase("ready")),
      window.updater.onUpdateNotAvailable(() => setPhase("no-update")),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
  }, []);

  return (
    <div className="flex flex-col min-h-screen w-full bg-[#0d0d0d] text-[#e5e5e5]">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="
        sticky top-0 z-10 shrink-0
        flex items-center gap-3!
        bg-[#111] border-b border-[#1e1e1e]
        px-6! h-13!
      ">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="
            w-8.5! h-8.5! rounded-lg! flex items-center justify-center
            bg-transparent border border-[#2a2a2a] text-[#999] cursor-pointer
            transition-all duration-150
            hover:bg-[#1a1a1a] hover:border-[#137fec44] hover:text-[#137fec]
          "
        >
          <ArrowLeftIcon />
        </button>
        <h1 className="text-[17px]! font-semibold tracking-[0.01em]">
          Cập nhật ứng dụng
        </h1>
      </header>

      {/* ── Main ──────────────────────────────────────────────────────────────── */}
      <main className="flex-1 p-6! md:px-8! md:py-7! overflow-y-auto max-w-2xl">

        {!data && phase === "idle" && (
          <div className="flex items-center justify-center py-20!">
            <div className="w-8 h-8 animate-spin rounded-full border-3 border-[#1e1e1e] border-t-[#137fec]" />
          </div>
        )}

        {phase === "no-update" && (
          <div className="flex flex-col items-center justify-center py-20! text-center">
            <div className="w-14! h-14! rounded-full bg-[#111] border border-[#1e1e1e] flex items-center justify-center mb-4!">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
                strokeLinecap="round" strokeLinejoin="round" className="w-7! h-7! text-[#555]">
                <circle cx="12" cy="12" r="10" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </div>
            <p className="text-[14px]! text-[#aaa] font-medium">Không có bản cập nhật mới</p>
            <p className="text-[12px]! text-[#666] mt-1!">Bạn đang dùng phiên bản mới nhất.</p>
          </div>
        )}

        {data && (
          <>
            {/* Version badge */}
            <div className="flex items-center gap-3! mb-5!">
              <div className="w-11! h-11! rounded-xl! bg-[#137fec18] border border-[#137fec30] flex items-center justify-center">
                <span className="text-[#137fec] text-[17px]! font-bold">v</span>
              </div>
              <div>
                <p className="text-[13px]! text-[#888]">Có phiên bản mới</p>
                <p className="text-[20px]! font-bold">{data.version}</p>
              </div>
            </div>

            {/* Progress bar */}
            {phase === "downloading" && (
              <div className="mb-5!">
                <div className="flex justify-between text-[11px]! text-[#888] mb-1.5!">
                  <span>Đang tải bản cập nhật</span>
                  <span>{progress.percent}% — {progress.transferred}/{progress.total} MB</span>
                </div>
                <div className="h-1.5! rounded-full bg-[#1e1e1e] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#137fec] transition-all duration-300"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Ready action */}
            {phase === "ready" && (
              <div className="mb-5!">
                <div className="flex items-center gap-3! p-4! rounded-xl! bg-[#137fec10] border border-[#137fec30]">
                  <div className="w-2! h-2! rounded-full bg-green-500 shrink-0" />
                  <p className="text-[13px]! text-[#aaa]">
                    Bản cập nhật đã tải xong. Khởi động lại ứng dụng để áp dụng.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => window.api.relaunch()}
                  className="
                    mt-3! w-full py-2.5! rounded-lg! text-[13px]! font-semibold
                    bg-[#137fec] text-white cursor-pointer
                    transition-all duration-150 hover:bg-[#137fecdd] active:scale-[0.98]
                  "
                >
                  Khởi động lại ngay
                </button>
              </div>
            )}

            {/* Changelog */}
            {notes && (
              <section>
                <p className="text-[11px]! text-[#555] uppercase tracking-[0.07em] font-medium mb-3!">
                  Thay đổi
                </p>
                <div className="rounded-xl! bg-[#111] border border-[#1e1e1e] p-4! max-h-[60vh] overflow-y-auto">
                  {renderMd(notes)}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
