import type { Metadata } from "next";
import "./globals.css";
import FeedbackProvider from "@/components/feedback";
import SiteHeader from "@/components/site-header";
export const metadata: Metadata = {
  title: { default: "Travel — A little room for adventure", template: "%s · Travel" },
  description: "A shared notebook for the trips you might take. Gather destinations, compare ideas, and plan the cost.",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><FeedbackProvider><SiteHeader />{children}</FeedbackProvider></body></html>;
}
