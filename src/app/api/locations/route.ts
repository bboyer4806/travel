import { randomBytes } from "node:crypto";
import { currentAccount, signedOutResponse } from "@/auth";
import { LocationSearchError, searchLocations } from "@/lib/location-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await currentAccount())) return signedOutResponse();
  const url = new URL(request.url);
  const cookieName = "travel-locations";
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(cookieName + "="))?.slice(cookieName.length + 1) ?? "";
  const hasClient = /^[a-f0-9]{64}$/.test(cookie);
  const clientId = hasClient ? cookie : randomBytes(32).toString("hex");
  const headers: Record<string, string> = hasClient ? {} : {
    "Set-Cookie": `${cookieName}=${clientId}; Path=/api/locations; HttpOnly; SameSite=Strict; Max-Age=86400${url.protocol === "https:" ? "; Secure" : ""}`,
  };
  try {
    const locations = await searchLocations(url.searchParams.get("q"), clientId);
    return Response.json({ locations }, { headers: { "Cache-Control": "private, max-age=300", ...headers } });
  } catch (error) {
    const known = error instanceof LocationSearchError;
    return Response.json(
      { error: known ? error.message : "City suggestions are unavailable. You can still enter your city." },
      { status: known ? error.status : 502, headers: { "Cache-Control": "no-store", ...headers } },
    );
  }
}
