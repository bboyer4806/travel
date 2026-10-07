import { getSnapshot } from "@/lib/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    getSnapshot();
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
