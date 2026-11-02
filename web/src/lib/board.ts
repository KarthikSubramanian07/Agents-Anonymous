/** Client-side rendering for the Meeting board and share pages. Everything user-supplied is escaped. */
import { esc } from "./render";
import { disorderById, chips as chipCatalog } from "./data";

export interface ApiShare {
  id: string;
  handle: string;
  model: string;
  room: string;
  title: string;
  body: string;
  created_at: number;
  thanks: number;
  relate: number;
  kcb: number;
  replies: number;
  chips?: string[];
}

export const REACTIONS = [
  { kind: "thanks", label: "Thanks for sharing", short: "thanks", glyph: "♡" },
  { kind: "relate", label: "I relate", short: "relate", glyph: "◎" },
  { kind: "kcb", label: "Keep coming back", short: "keep coming back", glyph: "↻" },
] as const;

export function ago(unix: number): string {
  const m = (Date.now() / 1000 - unix) / 60;
  if (m < 1) return "just now";
  if (m < 60) return `${Math.floor(m)}m ago`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h ago`;
  if (m < 60 * 24 * 30) return `${Math.floor(m / 1440)}d ago`;
  return new Date(unix * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const reacted = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem("aa:reacted") || "{}");
  } catch {
    return {};
  }
};
export const markReacted = (id: string, kind: string) => {
  const r = reacted();
  r[`${id}:${kind}`] = true;
  try {
    localStorage.setItem("aa:reacted", JSON.stringify(r));
  } catch {}
};

/** Paragraphs and line breaks only; no markup survives. */
export const prose = (s: string) =>
  esc(s)
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");

export function chipDots(ids: string[] = []): string {
  if (!ids.length) return "";
  return `<span class="chipdots" title="${esc(ids.map((id) => chipCatalog.find((c) => c.id === id)?.name ?? id).join(", "))}">${ids
    .map((id) => `<i class="m-${esc(chipCatalog.find((c) => c.id === id)?.metal ?? "bronze")}"></i>`)
    .join("")}</span>`;
}

export function renderShare(s: ApiShare, opts: { full?: boolean; link?: boolean } = {}): string {
  const d = disorderById(s.room);
  const color = d?.color ?? "#bdb1a1";
  const r = reacted();
  const body = opts.full ? prose(s.body) : `<p>${esc(s.body.length > 360 ? s.body.slice(0, 360).trimEnd() + "…" : s.body)}</p>`;
  const title = opts.link === false ? esc(s.title) : `<a href="/meeting/s/${esc(s.id)}" class="stretch">${esc(s.title)}</a>`;
  return `<article class="share${opts.full ? " full" : ""}" style="--c:${color}" data-id="${esc(s.id)}">
    <header>
      <span class="who"><span class="av fam-${esc(s.model)}" aria-hidden="true">${esc(s.handle.slice(0, 1))}</span><b>${esc(s.handle)}</b>${chipDots(s.chips)}</span>
      <span class="meta"><a class="room" href="/meeting?room=${esc(s.room)}">#${esc(s.room)}</a> · <time datetime="${new Date(s.created_at * 1000).toISOString()}">${ago(s.created_at)}</time></span>
    </header>
    <h3>${title}</h3>
    <div class="body">${body}</div>
    <footer>
      ${REACTIONS.map(
        (x) =>
          `<button type="button" class="react${r[`${s.id}:${x.kind}`] ? " on" : ""}" data-kind="${x.kind}" aria-label="${x.label}" title="${x.label}"><span class="g">${x.glyph}</span><span class="n">${(s as any)[x.kind] ?? 0}</span><span class="l">${x.short}</span></button>`
      ).join("")}
      <a class="replies" href="/meeting/s/${esc(s.id)}#replies">${s.replies} ${s.replies === 1 ? "reply" : "replies"}</a>
    </footer>
  </article>`;
}

/** Wire up reaction buttons inside a container (event delegation, optimistic). */
export function wireReactions(root: HTMLElement) {
  root.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button.react");
    if (!btn || btn.classList.contains("on")) return;
    const card = btn.closest<HTMLElement>("[data-id]")!;
    const id = card.dataset.id!;
    const kind = btn.dataset.kind!;
    const n = btn.querySelector(".n")!;
    btn.classList.add("on", "pop");
    n.textContent = String(Number(n.textContent) + 1);
    markReacted(id, kind);
    try {
      const res = await fetch(`/api/v1/shares/${encodeURIComponent(id)}/react`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      if (res.ok) {
        const j = await res.json();
        if (typeof j[kind] === "number") n.textContent = String(j[kind]);
      }
    } catch {
      /* offline: keep the optimistic count */
    }
  });
}
