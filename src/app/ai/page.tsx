import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requestOrigin, requireAccount } from "@/auth";
import { MCP_PATH } from "@/lib/ai-auth";
import { aiOverview } from "@/lib/store";
import { revokeConnection } from "./actions";
import styles from "./ai.module.css";
import { formatMoment } from "./time";

export const metadata: Metadata = { title: "AI assistants" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS = { pending: "Waiting for you", applied: "Approved", rejected: "Rejected", failed: "Failed", expired: "Expired" } as const;

/** The designated owner's ChatGPT and Claude connections and their proposals (TRA-115). Anyone else finds nothing here. */
export default async function AiAssistantsPage() {
  const account = await requireAccount();
  const overview = aiOverview(account.id);
  if (!overview) notFound();
  const endpoint = (await requestOrigin()) + MCP_PATH;
  return <main id="main-content" className={`main-content ${styles.page}`}>
    <Link href="/" className="breadcrumb">← All trips</Link>
    <p className="eyebrow">ONLY YOU CAN SEE THIS</p>
    <h1>AI assistants</h1>
    <p className="hero-description">Connect ChatGPT or Claude to read every trip, destination and account in Travel, whoever owns them, and to propose changes. Nothing changes until you approve a proposal on its page here.</p>

    <section className={styles.section} aria-labelledby="connect-heading">
      <h2 id="connect-heading">Connect</h2>
      <p>Add Travel as a custom connector with this address. You&apos;ll come back to Travel, signed in as yourself, to allow it.</p>
      <p className={styles.endpoint}><code>{endpoint}</code></p>
      <ul className={styles.steps}>
        <li><strong>Claude:</strong> Settings → Connectors → Add custom connector.</li>
        <li><strong>ChatGPT:</strong> with developer mode on, create a custom app or connector with this address and OAuth authentication.</li>
      </ul>
    </section>

    <section className={styles.section} aria-labelledby="connections-heading">
      <h2 id="connections-heading">Connections</h2>
      {overview.connections.length === 0 ? <p className={styles.muted}>No assistant is connected.</p> : <ul className={styles.list}>
        {overview.connections.map((connection) => <li key={connection.id} className={styles.item}>
          <span className={styles.identity}><strong>{connection.platform}</strong><span className={styles.muted}>Connected {formatMoment(connection.connectedAt)} · last renewed {formatMoment(connection.lastUsedAt)}</span></span>
          <form action={revokeConnection}><input type="hidden" name="connectionId" value={connection.id} /><button type="submit" className="button secondary small">Revoke</button></form>
        </li>)}
      </ul>}
      <p className={styles.muted}>Revoking ends a connection at once and withdraws its proposals. A connection unused for 30 days ends by itself.</p>
    </section>

    <section className={styles.section} aria-labelledby="proposals-heading">
      <h2 id="proposals-heading">Proposals</h2>
      {overview.proposals.length === 0 ? <p className={styles.muted}>No proposals yet.</p> : <ul className={styles.list}>
        {overview.proposals.map((proposal) => <li key={proposal.id} className={styles.item}>
          <span className={styles.identity}><Link href={`/ai/proposals/${proposal.id}`} className={styles.link}>{proposal.summary}</Link><span className={styles.muted}>{proposal.platform} · {formatMoment(proposal.createdAt)} · {proposal.preview.length} {proposal.preview.length === 1 ? "change" : "changes"}</span></span>
          <span className={`${styles.status} ${styles[proposal.status]}`}>{STATUS[proposal.status]}</span>
        </li>)}
      </ul>}
    </section>
  </main>;
}
