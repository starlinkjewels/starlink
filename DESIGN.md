# DESIGN.md — Starlink Jewels

The design system for the Starlink Jewels portal, adapted from the Liquid Glass template: a floating functional layer (bars, sidebar, sheets, menus) over a calm content layer (cards, rows, tables), with semantic colour roles.

Value tags: **(Apple)** = rule from Apple's published guidance, keep it. **(default)** = a starting value, may be tuned. **(project)** = decided for this product.

## A. Project facts

| Item | Value |
|---|---|
| Product | Starlink Jewels: a B2B diamond-jewellery order, production, stock and billing portal (PWA) |
| Profile | Productivity / dashboard on laptops; mobile app on phones (same code, responsive) |
| Platform and toolkit | Web: Vite + React 19 + TypeScript, Tailwind CSS v4, Radix UI (shadcn), framer-motion |
| Theme source of truth | `src/styles.css` (tokens as CSS custom properties on `:root`); `src/lib/appearance.ts` (choices) |
| Input | Touch on phones; mouse and keyboard on laptops |
| Hardware floor and blur tier | Mid/low-end Android phones → Tier A only where `backdrop-filter` works, with a thick fill (≥ 85%) so it reads without blur |
| Data liveness | Live (Firestore snapshots) — data changes never animate beyond a cross-fade |
| Accessibility target | WCAG 2.2 AA (4.5:1 body text) |
| Breakpoints | phone < 640 (`sm`), tablet < 768 (`md`), laptop ≥ 768 — the sidebar appears at `md` |

## 1. How looks are chosen (project)

Admins pick the look in **Settings → Appearance**. It is saved once for everyone (`settings.appearance`) and remembered per device (`localStorage["ui:appearance"]`), so the next start opens in it without a flash. Choices are attributes on `<html>`; **the defaults set none, so Classic is exactly the app as built.**

| Attribute | Values | Default (no attribute) |
|---|---|---|
| `data-ui` | `glass` (Liquid Glass), `flat` (Modern Flat), `ivory` (Luxe Ivory) | Classic |
| `data-accent` | `sapphire`, `emerald`, `gold`, `ruby`, `graphite` | Royal blue |
| `data-corners` | `sharp`, `round` | Normal |
| `data-headings` | `sans` | Elegant serif (Cormorant Garamond) |
| `data-motion` | `calm` | Smooth |

Table looks are separate: **Settings → Table Style** (`data-tbl*`, `src/lib/tableStyle.ts`).

## 2. Core rules (apply in every look)

1. **Two layers.** Content (cards, rows, tables, KPIs, chips) is solid. Glass is only for what floats: header, sidebar, phone tab bar, dialogs/sheets, menus. (Apple)
2. **No glass on glass.** Anything inside a sheet or menu uses fills, never another glass surface. (Apple)
3. **Glass has no colour of its own.** One tinted primary action per surface (`btn-hero`). (Apple)
4. **Never colour alone.** Every status pairs colour with text or an icon.
5. **Phones get sheets.** Every dialog rises from the bottom, full width, with a grab handle and the home-bar inset; laptops get a centred dialog.
6. **Motion is feedback for what the user did.** Live data never bounces or slides.
7. **Numbers use lining figures.** The display serif's old-style digits make "1" read as "I"; `h1–h3` and `.font-display` force `lining-nums` (also when combined with `tabular-nums`).

## 3. Layer map

| Surface | File / hook | Layer | Treatment |
|---|---|---|---|
| App ground | `AppLayout` → `.app-shell` | — | Liquid Glass: soft ambient wash the glass picks colour from |
| Sidebar (laptop) | `AppLayout` → `.app-sidebar` | Glass | Liquid Glass: inset floating panel, 28 radius |
| Header | `AppLayout` → `.app-header` (+ `glass`) | Glass (small) | Liquid Glass on laptop: inset capsule, 22 radius; title as plain text |
| Phone tab bar | `AppLayout` → `.app-tabbar` (+ `glass`) | Glass (small) | Selected tab on a tonal pill; Liquid Glass: floating capsule above the home bar |
| "More" sheet (phone) | `AppLayout` → `.ui-dialog.app-more-sheet` | Glass (large) | Bottom sheet |
| Cards | `card-luxe` utility (159 uses) | Content | Reads `--card-bg/-radius/-line/-shadow`; solid in every look |
| Stat / KPI cards | `StatCard`, `AccountSummary`, report KPIs | Content | Labels wrap (never "TOTAL…"); short labels on phones |
| Tables | `DataTable`, `table-luxe`, plain `<table>` | Content | Settings → Table Style |
| Dialogs | `ui/dialog.tsx`, `ui/alert-dialog.tsx` → `.ui-dialog` + `.ui-scrim` | Glass (large) | Sheet on phones; dialog on laptops |
| Hand-made modals | `ExportDialog`, OrderDetail deliver / dispatch / final approval, StockSection edit packet | Glass (large) | Same sheet treatment via `ui-dialog`/`ui-scrim` and `max-sm:` classes |
| Menus, selects, popovers | Radix popper content (`[data-radix-popper-content-wrapper] > .bg-popover`) | Glass (large) | Liquid Glass: frosted, 16 radius |
| Primary action | `btn-hero` utility (118 uses) | Tinted | Reads `--hero-bg/-shadow`; Liquid Glass adds a spring press |

## 4. Tokens

**Shared surfaces read variables whose fallbacks are their Classic values** — a look only sets variables, so a card a page deliberately colours keeps its colour. (project)

| Variable | Used by | Classic fallback |
|---|---|---|
| `--card-bg`, `--card-radius`, `--card-line`, `--card-shadow` | `card-luxe` | white gradient, 1.25rem, border 55%, `--shadow-luxe` |
| `--card-lift`, `--card-hover-shadow` | `card-hover` | lift 2px, deep blue shadow |
| `--glass-bg`, `--glass-filter`, `--glass-line` | `glass` | white 88%, `saturate(140%) blur(14px)` |
| `--hero-bg`, `--hero-shadow` | `btn-hero` | brand → brand-dark gradient |
| `--radius` | every `rounded-*` | 1rem |

Colour roles are the existing shadcn variables (`--primary`, `--brand`, `--brand-dark`, `--brand-light`, `--secondary`, `--muted`, `--border`, `--ring`, sidebar roles). Accents swap only those values.

Glass recipe (default): small = `white 64%` + `saturate(180%) blur(24px)` + white rim; large (sheets) = `white 85%` + `blur(32px)`; menus = `white 86%` + `blur(24px)`.

**Build gotcha (project):** write only `backdrop-filter` in `styles.css`. With both it and `-webkit-backdrop-filter` written, the build (Lightning CSS) keeps only the prefixed one, which Chrome ignores — the bars were never frosted in Chrome until this was fixed.

## 5. Motion

- Dialogs: fade + zoom 95 → 100 on laptops; slide up 300ms on phones.
- Liquid Glass primary buttons: press to scale 0.96, release on a soft spring `cubic-bezier(0.34, 1.56, 0.64, 1)`.
- **Calm** (`data-motion="calm"`): every animation and transition is 0.01ms; spinners keep spinning.
- `prefers-reduced-motion: reduce` turns off the press spring.

## 6. Accessibility modes

| Mode | Effect |
|---|---|
| `prefers-reduced-transparency: reduce` or `prefers-contrast: more` | Every glass surface turns solid (`--color-card`) with a clear border, no blur |
| `prefers-reduced-motion: reduce` | No press spring; Calm motion available for everyone in Settings |
| Icon-only controls | Have `aria-label` (search, swatches, dialog close) |
| Touch targets | Dialog close is 32px; tab bar items are at least 56px wide |

## 7. Don'ts (check every UI diff)

- [ ] No glass on content: cards, rows, tables, KPIs, status chips.
- [ ] No glass inside glass.
- [ ] No more than one tinted control per surface; no tint for decoration.
- [ ] No colour as the only signal.
- [ ] No motion on live data beyond a cross-fade.
- [ ] No hard-coded radii, colours or shadows on shared surfaces — use the variables above.
- [ ] No `-webkit-backdrop-filter` written next to `backdrop-filter`.
- [ ] No new centred-only modal: use `Dialog` (it is a sheet on phones), or add `ui-scrim`/`ui-dialog` and the `max-sm:` sheet classes.
- [ ] No `truncate` on a stat label — use `line-clamp-2`, or a short label on phones.

## 8. Decisions taken

| # | Decision | Answer |
|---|---|---|
| 1 | Blur tier | Tier A where the browser supports it, with fills thick enough to read without blur |
| 2 | New dependencies | None — CSS variables and attributes only |
| 3 | Default look | Classic stays the default; admins opt in from Settings → Appearance |
| 4 | Scope of a look | For everyone (admin saves), remembered per device for a flash-free start |

## 9. Progress

- DONE 2026-10-11 — Appearance setting (4 looks, 6 accents, corners, headings, motion); dialogs and hand-made modals as phone sheets; glass blur fixed for Chrome; lining figures; stat labels wrap; phone search as an icon button; selected tab pill; compact section tiles (Payments, Buy & Assign); full-width invoice search on phones; Activity header.
- TODO — Dark mode: many pages hard-code `bg-white`, so it needs a page-by-page pass before it can be offered.
