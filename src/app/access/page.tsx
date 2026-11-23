import { requireAccount } from "@/auth";
import AccessChart from "@/components/access-chart";
import { getAccessOverview } from "@/lib/store";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: "Access" };
/** Who can open each trip and destination the signed-in account can (TRA-162), read afresh on every load. */
export default async function AccessPage() {
  const account = await requireAccount();
  return <AccessChart overview={getAccessOverview(account.id)} />;
}
