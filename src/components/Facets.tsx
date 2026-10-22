/** A brilliant cut seen from above, in fine lines — the sign-in panel's ornament, and a loose-stones order's tile. */
export function Facets({ className = "" }: { className?: string }) {
  const R = 100, r = 58, pts = (rad: number, n: number, off = 0) =>
    Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 + off; return [Math.cos(a) * rad, Math.sin(a) * rad]; });
  const outer = pts(R, 16), table = pts(r, 8, Math.PI / 8), star = pts(r * 1.32, 8);
  return (
    <svg viewBox="-110 -110 220 220" className={className} fill="none" stroke="currentColor" strokeWidth="0.6" aria-hidden>
      <polygon points={outer.map(p => p.join(",")).join(" ")} />
      <polygon points={table.map(p => p.join(",")).join(" ")} />
      {table.map((t, i) => <line key={`a${i}`} x1={t[0]} y1={t[1]} x2={star[i][0]} y2={star[i][1]} />)}
      {table.map((t, i) => <line key={`b${i}`} x1={t[0]} y1={t[1]} x2={star[(i + 1) % 8][0]} y2={star[(i + 1) % 8][1]} />)}
      {star.map((s, i) => <line key={`c${i}`} x1={s[0]} y1={s[1]} x2={outer[i * 2][0]} y2={outer[i * 2][1]} />)}
      {star.map((s, i) => <line key={`d${i}`} x1={s[0]} y1={s[1]} x2={outer[(i * 2 + 15) % 16][0]} y2={outer[(i * 2 + 15) % 16][1]} />)}
      {star.map((s, i) => <line key={`e${i}`} x1={s[0]} y1={s[1]} x2={outer[(i * 2 + 1) % 16][0]} y2={outer[(i * 2 + 1) % 16][1]} />)}
    </svg>
  );
}
