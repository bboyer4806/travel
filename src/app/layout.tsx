import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "Travel — A little room for adventure", template: "%s · Travel" },
  description: "A shared notebook for the trips you might take. Gather destinations, compare ideas, and plan the cost.",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
