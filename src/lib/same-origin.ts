/**
 * Whether a request to one of Travel's own routes came from a page of Travel's, as Send feedback's (TRA-92) and Add image
 * by URL's (TRA-139) must. Next.js checks Server Actions this way itself.
 */
export function sameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  // Next standalone's request.url may use its internal 0.0.0.0 bind address.
  // Dokku preserves Host. Never use a caller-supplied forwarded host or IP as identity.
  if (!origin || (site && site !== "same-origin")) return false;
  try {
    const url = new URL(origin);
    return origin === url.origin && ["http:", "https:"].includes(url.protocol) && url.host === (request.headers.get("host") ?? new URL(request.url).host);
  } catch { return false; }
}
