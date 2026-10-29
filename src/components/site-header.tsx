"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { Compass } from "lucide-react";
import { hasUnreadRelease, publishedReleases, releases } from "@/lib/change-log";

const key = "travel.latestSeenRelease";
let sessionSeen: string | null = null;
function readSeen() { try { return localStorage.getItem(key) ?? sessionSeen; } catch { return sessionSeen; } }
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("travel-release-seen", callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener("travel-release-seen", callback); };
}

export default function SiteHeader() {
  const pathname = usePathname();
  const latest = publishedReleases(releases)[0]?.version;
  const seen = useSyncExternalStore(subscribe, readSeen, () => null);
  const unread = pathname !== "/whats-new" && hasUnreadRelease(latest, seen);
  useEffect(() => {
    if (pathname !== "/whats-new" || !latest) return;
    sessionSeen = latest;
    try { localStorage.setItem(key, latest); } catch { /* This browser session still remembers. */ }
    window.dispatchEvent(new Event("travel-release-seen"));
  }, [pathname, latest]);
  return <header className="site-header"><Link href="/" className="brand"><span className="brand-mark"><Compass size={24} strokeWidth={1.6} /></span><span>travel<span className="brand-dot">.</span></span></Link>
    <nav aria-label="Main navigation"><Link href="/" className={pathname === "/" ? "nav-link active" : "nav-link"} aria-current={pathname === "/" ? "page" : undefined}>All trips</Link><Link href="/whats-new" className={pathname === "/whats-new" ? "nav-link active" : "nav-link"} aria-current={pathname === "/whats-new" ? "page" : undefined}>What&apos;s new{unread && <span className="unread-dot"><span className="sr-only"> new</span></span>}</Link></nav>
    <span className="shared-label"><span />Shared notebook</span>
  </header>;
}
