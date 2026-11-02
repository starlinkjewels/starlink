// GENERATED from src/lib/pure/shareHtml.ts by functions/scripts/sync-shared.cjs - do not edit here.
// A shared folder link (/s/:id), drawn on the server straight into the page.
//
// The link used to open on a spinner: the whole app (megabytes) had to load,
// sign-in had to start, the database had to answer, every page of items had to
// arrive — only then did the first photo show. Now the server that already
// reads the share for WhatsApp's preview (api/share.ts on Vercel, the
// shareMeta function for Firebase Hosting) also writes the gallery itself into
// the page, and the share's data beside it: the visitor sees the folder at
// once, and the app, when it has loaded, takes over the same view from that
// data without asking the database again (src/pages/SharedGallery.tsx).
//
// Plain functions, no imports: the Firebase functions build copies this file
// (functions/scripts/sync-shared.cjs), and Vercel's edge bundles it.

/** One photo or video of a shared folder, as the share keeps it. */
export interface StaticShareItem { type?: string; url?: string; thumb?: string; name?: string; folder?: string; folderId?: string }
export interface StaticShareFolder { id: string; name: string; parentId: string | null }
export interface StaticShare { title?: string; kind?: string; folders?: StaticShareFolder[]; items?: StaticShareItem[]; pageCount?: number; count?: number }

/** The id of the <script> the share's data rides in. */
export const SHARE_DATA_ID = "share-data";
/** Past this many items the data is not written into the page (it would make the
 *  page itself slow); the app then reads the rest as before. */
export const SHARE_EMBED_MAX = 3000;
/** Photos drawn by the server per view — the app shows the rest when it takes over. */
const STATIC_ITEMS = 60;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Only web addresses are put into src/href — nothing else can ride in. */
const safeUrl = (u?: string) => (u && /^https:\/\//.test(u) ? esc(u) : "");

/**
 * The share's data for the app, as a JSON <script>. "<" is written as its
 * escape so nothing in a name or address can close the tag early.
 */
export function shareDataScript(data: { id: string; share: StaticShare; items: StaticShareItem[] | null }): string {
  // Line/paragraph separators (U+2028/9) are written as escapes too.
  const json = JSON.stringify(data).replace(/</g, "\\u003c")
    .split(String.fromCharCode(0x2028)).join("\\u2028").split(String.fromCharCode(0x2029)).join("\\u2029");
  return `<script type="application/json" id="${SHARE_DATA_ID}">${json}</script>`;
}

/**
 * The folder as the visitor first sees it — the same markup and classes as
 * the app's own page, so nothing jumps when the app takes over. `folderId`:
 * a sub-folder opened by its link (?f=); unknown or absent = the shared folder.
 * Folder cards are plain links (they work before the app has loaded); a photo
 * opens full size.
 */
export function renderShareStatic(o: { id: string; share: StaticShare; items: StaticShareItem[]; brand: string; folderId?: string }): string {
  const folders = o.share.folders ?? [];
  const browsable = folders.length > 0;
  const here = browsable && o.folderId ? folders.find(f => f.id === o.folderId) : undefined;
  const hereId = here?.id ?? null;
  const path: StaticShareFolder[] = [];
  for (let f = here; f; f = f.parentId ? folders.find(x => x.id === f!.parentId) : undefined) path.unshift(f);
  const subFolders = browsable ? folders.filter(f => (f.parentId ?? null) === hereId) : [];
  const items = browsable ? o.items.filter(it => (it.folderId ?? null) === hereId) : o.items;
  const title = here ? here.name : o.share.title || o.brand;
  const under = (fid: string) => {
    const ids = new Set([fid]);
    for (let grew = true; grew;) { grew = false; for (const f of folders) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; } }
    return ids;
  };
  const link = (fid: string | null) => `/s/${encodeURIComponent(o.id)}${fid ? `?f=${encodeURIComponent(fid)}` : ""}`;
  const pic = (it: StaticShareItem) => safeUrl(it.thumb) || safeUrl(it.url);

  const crumbs = [`<a href="${link(null)}" class="font-medium ${path.length ? "text-primary hover:underline" : "text-brand-dark"}">${esc(o.share.title || o.brand)}</a>`,
    ...path.map((f, i) => `<span class="flex items-center gap-1 min-w-0"><span class="text-muted-foreground">›</span><a href="${link(f.id)}" class="font-medium truncate ${i === path.length - 1 ? "text-brand-dark" : "text-primary hover:underline"}">${esc(f.name)}</a></span>`)].join("");
  const count = `${subFolders.length ? `${subFolders.length} folder${subFolders.length !== 1 ? "s" : ""} · ` : ""}${items.length} item${items.length !== 1 ? "s" : ""}`;

  const folderCards = subFolders.map(f => {
    const ids = under(f.id);
    const n = o.items.filter(it => it.folderId && ids.has(it.folderId)).length;
    const cover = o.items.find(it => it.folderId === f.id && (it.type === "image" || (it.type === "video" && !!it.thumb)));
    return `<a href="${link(f.id)}" class="block rounded-2xl overflow-hidden border border-border/60 bg-white shadow-sm text-left">`
      + `<div class="aspect-square bg-secondary/30 overflow-hidden">${cover && pic(cover) ? `<img src="${pic(cover)}" alt="${esc(f.name)}" loading="lazy" decoding="async" class="w-full h-full object-cover" />` : ""}</div>`
      + `<div class="px-2.5 pt-2 pb-2"><p class="text-sm font-medium text-brand-dark truncate">${esc(f.name)}</p><p class="text-[11px] text-muted-foreground">${n} items</p></div></a>`;
  }).join("");

  const tiles = items.slice(0, STATIC_ITEMS).map((it, i) => {
    const full = safeUrl(it.url);
    const load = i < 8 ? 'fetchpriority="high"' : 'loading="lazy"';
    // A video: its saved still, else the video's own first moments (only the start of the file).
    const play = `<div class="absolute inset-0 flex items-center justify-center pointer-events-none"><div class="h-12 w-12 rounded-full bg-black/40 flex items-center justify-center text-white text-lg">▶</div></div>`;
    const img = it.type === "image" && pic(it)
      ? `<img src="${pic(it)}" alt="${esc(it.name ?? "")}" ${load} decoding="async" class="w-full h-full object-cover" />`
      : it.type === "video" && safeUrl(it.thumb)
      ? `<img src="${safeUrl(it.thumb)}" alt="${esc(it.name ?? "")}" ${load} decoding="async" class="w-full h-full object-cover" />${play}`
      : it.type === "video" && full
      ? `<video src="${full.split("#")[0]}#t=0.1" preload="metadata" muted playsinline class="w-full h-full object-cover pointer-events-none bg-slate-200"></video>${play}`
      : `<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400 text-xs">File</div>`;
    return `<div class="relative rounded-2xl overflow-hidden border border-border/60 bg-white shadow-sm flex flex-col">`
      + `<a href="${full}" target="_blank" rel="noopener" class="block w-full aspect-square bg-secondary/30 overflow-hidden relative">${img}</a>`
      + (it.name || it.folder ? `<div class="px-2.5 pt-2 pb-1.5"><p class="text-[11px] text-foreground font-medium truncate">${esc(it.name ?? "")}</p>${it.folder ? `<p class="text-[10px] text-muted-foreground truncate">${esc(it.folder)}</p>` : ""}</div>` : "")
      + `</div>`;
  }).join("");

  const grid = "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-auto-photos gap-3 sm:gap-4";
  return `<div class="fixed inset-0 overflow-y-auto overscroll-contain bg-[#F7F9FC]">`
    + `<header class="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-border/60"><div class="max-w-6xl mx-auto px-4 h-14 flex items-center gap-2 min-w-0"><span class="font-display text-brand-dark text-lg truncate">${esc(o.brand)}</span></div></header>`
    + `<main class="max-w-6xl mx-auto px-4 py-6"><div class="mb-5"><nav class="flex items-center gap-1 flex-wrap text-sm mb-1">${crumbs}</nav>`
    + `<h1 class="font-display text-2xl md:text-3xl text-brand-dark">${esc(title)}</h1><p class="text-sm text-muted-foreground mt-0.5">${count}</p></div>`
    + (folderCards ? `<div class="${grid} mb-6">${folderCards}</div>` : "")
    + (tiles ? `<div class="${grid}">${tiles}</div>` : (folderCards ? "" : `<div class="py-20 text-center text-muted-foreground">This folder is empty.</div>`))
    + `</main></div>`;
}

/** The page with the gallery and its data written in — `html` is the app's index.html. */
export function withSharePage(html: string, o: { id: string; share: StaticShare; items: StaticShareItem[] | null; brand: string; folderId?: string }): string {
  const isFolder = o.share.kind !== "readyStock";
  const data = shareDataScript({ id: o.id, share: o.share, items: o.items });
  const body = isFolder && o.items ? renderShareStatic({ id: o.id, share: o.share, items: o.items, brand: o.brand, folderId: o.folderId }) : "";
  // Functions, not strings, as the replacement: a "$&" or "$'" in a name would
  // otherwise be read as a pattern and corrupt the page.
  return html
    .replace("</head>", () => `  ${data}\n  </head>`)
    .replace(/<div id="root"><\/div>/, () => `<div id="root">${body}</div>`);
}
