import { checkHealth } from "@/lib/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    checkHealth();
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
