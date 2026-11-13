import type { Metadata } from "next";
import "./globals.css";
import { currentAccount } from "@/auth";
import FeedbackProvider from "@/components/feedback";
import SiteHeader from "@/components/site-header";
import { isAiOwner } from "@/lib/store";
export const metadata: Metadata = {
  title: { default: "Travel — A little room for adventure", template: "%s · Travel" },
  description: "A shared notebook for the trips you might take. Gather destinations, compare ideas, and plan the cost.",
  robots: { index: false, follow: false },
};
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Display only. Every page, action and data route checks the session itself.
  const account = await currentAccount();
  if (!account) return <html lang="en"><body><SiteHeader account={null} />{children}</body></html>;
  return <html lang="en"><body><FeedbackProvider><SiteHeader account={{ email: account.email, name: account.name, aiOwner: isAiOwner(account.id) }} />{children}</FeedbackProvider></body></html>;
}
