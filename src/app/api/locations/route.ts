import { LocationSearchError, searchLocations } from "@/lib/location-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const locations = await searchLocations(new URL(request.url).searchParams.get("q"));
    return Response.json({ locations }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    const known = error instanceof LocationSearchError;
    return Response.json(
      { error: known ? error.message : "City suggestions are unavailable. You can still enter your city." },
      { status: known ? error.status : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
