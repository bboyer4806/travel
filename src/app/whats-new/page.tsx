import Link from "next/link";
import { publishedReleases, releases } from "@/lib/change-log";
import { formatCalendarDate } from "@/lib/trip-dates";

export const metadata = { title: "What's new" };
export default function WhatsNewPage() {
  const entries = publishedReleases(releases);
  return <main id="main-content" className="main-content change-log"><Link href="/" className="breadcrumb">← All trips</Link><h1>What&apos;s new</h1><p className="hero-description">The latest improvements to your travel notebook.</p>
    {entries.length === 0 ? <p className="empty-state">No releases yet.</p> : entries.map((release) => <article key={release.version} className="release-entry"><h2>Travel {release.version}</h2><time dateTime={release.date}>{formatCalendarDate(release.date)}</time><ul>{release.changes.map((change) => <li key={change}>{change}</li>)}</ul></article>)}
  </main>;
}
