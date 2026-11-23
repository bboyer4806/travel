"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ArrowDownAZ, ArrowDownZA, Search } from "lucide-react";
import { Person } from "@/components/trip-sharing";
import { formatSavedDestinationLabel } from "@/lib/destination-label";
import type { AccessEntry, AccessOverview } from "@/lib/types";
import styles from "./access-chart.module.css";

/** A row of an Access table: the name it shows, the page that name opens, and the text its search finds it by. */
type Row = AccessEntry & { name: string; href: string; searchText: string };

/**
 * Access (TRA-162): who can open each trip and destination the account can, as the store found it when the page loaded,
 * in two tables searched by name and sorted alphabetically. Nothing here changes who has access.
 */
export default function AccessChart({ overview }: { overview: AccessOverview }) {
  const trips = overview.trips.map((trip): Row => ({ ...trip, href: "/trips/" + trip.id, searchText: trip.name }));
  const destinations = overview.destinations.map((destination): Row => {
    const name = formatSavedDestinationLabel(destination);
    return { ...destination, name, href: "/destinations/" + destination.id, searchText: name + " " + destination.city };
  });
  return <main id="main-content" className="main-content">
    <section className="ideas-heading"><div><p className="eyebrow">WHO CAN OPEN WHAT</p><h1>Access</h1><p className="hero-description">Who can open each trip and destination you can. Only a trip&apos;s owner can change who has access, with Share on the trip&apos;s page.</p></div></section>
    <AccessTable heading="Trips" column="Trip" placeholder="Find a trip" rows={trips} />
    <AccessTable heading="Destinations" column="Destination" placeholder="Find a destination" rows={destinations}
      intro="A destination is open to its owner and to everyone a trip that visits it is shared with." />
  </main>;
}

/**
 * One table, its rows in alphabetical order until its column's heading turns them around. Its owner sees everyone who can
 * open each row; for someone else's, the row says only its owner sees who else has access.
 */
function AccessTable({ heading, column, placeholder, intro, rows }: { heading: "Trips" | "Destinations"; column: string; placeholder: string; intro?: string; rows: Row[] }) {
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState<"ascending" | "descending">("ascending");
  const headingId = useId();
  const found = rows.filter((row) => row.searchText.toLowerCase().includes(search.toLowerCase()));
  const shown = order === "ascending" ? found : [...found].reverse();
  const plural = heading.toLowerCase();
  return <section className={`trips-section ${styles.section}`} aria-labelledby={headingId}>
    <div className="section-heading"><div className="heading-inline"><h2 id={headingId}>{heading}</h2><span className="count-pill">{rows.length}</span></div>
      {rows.length > 0 && <label className="search-field"><Search size={17} /><input aria-label={"Search " + plural} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={placeholder} /></label>}</div>
    {intro && <p className={styles.intro}>{intro}</p>}
    {rows.length === 0 ? <div className="empty-state"><h3>No {plural} yet.</h3></div>
      : shown.length === 0 ? <div className="empty-state"><h3>No {plural} match that search.</h3><button type="button" className="text-button" onClick={() => setSearch("")}>Clear search</button></div>
      : <div className={styles.scroll}><table className={styles.table} aria-labelledby={headingId}>
        <thead><tr>
          <th scope="col" aria-sort={order}><button type="button" className={styles.sort} onClick={() => setOrder(order === "ascending" ? "descending" : "ascending")}>{column}{order === "ascending" ? <ArrowDownAZ size={15} aria-hidden="true" /> : <ArrowDownZA size={15} aria-hidden="true" />}</button></th>
          <th scope="col">Owner</th>
          <th scope="col">Who has access</th>
        </tr></thead>
        <tbody>{shown.map((row) => <tr key={row.id}>
          <th scope="row"><Link href={row.href}>{row.name}</Link></th>
          <td><Person member={row.owner} /></td>
          <td><ul className={styles.people}>{[row.owner, ...row.sharedWith].map((member) => <li key={member.email}><Person member={member} /></li>)}</ul>
            {row.role === "editor" && <p className={styles.note}>Only its owner sees who else has access.</p>}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}
