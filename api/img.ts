// Product photos for the PDFs, read through this site (Vercel).
//
// A PDF is built in the browser, which has to read each photo's bytes — and
// Starlink's storage bucket does not let a browser do that (no CORS rule; the
// bucket is shared and left alone). So the browser asks this site instead,
// which fetches the photo and hands it back from the same address.
//
// Only Starlink's own storage, only files: anything else is refused.
export const config = { runtime: "edge" };

const ALLOWED = "/v0/b/starlinkjewels109.firebasestorage.app/o/";

export default async function handler(req: Request): Promise<Response> {
  const raw = new URL(req.url).searchParams.get("u") ?? "";
  let url: URL;
  try { url = new URL(raw); } catch { return new Response("Bad photo address", { status: 400 }); }
  if (url.protocol !== "https:" || url.hostname !== "firebasestorage.googleapis.com" || !url.pathname.startsWith(ALLOWED)) {
    return new Response("Not allowed", { status: 403 });
  }
  const r = await fetch(url.toString());
  if (!r.ok) return new Response("Photo not found", { status: r.status });
  const type = r.headers.get("content-type") ?? "application/octet-stream";
  if (!/^(image|video)\//.test(type)) return new Response("Not a photo", { status: 415 });
  return new Response(r.body, {
    status: 200,
    headers: { "content-type": type, "cache-control": "public, max-age=86400" },
  });
}
