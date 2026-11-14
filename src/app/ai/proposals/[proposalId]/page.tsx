import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAccount } from "@/auth";
import AiProposalDecision from "@/components/ai-proposal-decision";
import { getAiProposal } from "@/lib/store";
import type { AiProposal } from "@/lib/types";
import styles from "../../ai.module.css";
import { formatMoment } from "../../time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PHOTO_ALT = { Adds: "The photo it adds", Changes: "The photo it changes", Deletes: "The photo it deletes" } as const;

export async function generateMetadata({ params }: { params: Promise<{ proposalId: string }> }): Promise<Metadata> {
  const { proposalId } = await params;
  const account = await requireAccount();
  return { title: getAiProposal(account.id, proposalId)?.summary ?? "Proposal not found" };
}

/**
 * Where Travel's designated owner reviews and decides an AI proposal (TRA-115): every change, and every record each
 * adds, changes or deletes, before and after. Anyone else finds nothing here, as for a missing proposal.
 */
export default async function ProposalPage({ params }: { params: Promise<{ proposalId: string }> }) {
  const { proposalId } = await params;
  const account = await requireAccount();
  const proposal = getAiProposal(account.id, proposalId);
  if (!proposal) notFound();
  return <main id="main-content" className={`main-content ${styles.page}`}>
    <Link href="/ai" className="breadcrumb">← AI assistants</Link>
    <p className="eyebrow">PROPOSED BY {proposal.platform.toUpperCase()}</p>
    <h1>{proposal.summary}</h1>
    <p className={styles.muted}>Proposed {formatMoment(proposal.createdAt)} · {proposal.preview.length} {proposal.preview.length === 1 ? "change" : "changes"}</p>
    <Outcome proposal={proposal} />
    <ol className={styles.changes}>
      {proposal.preview.map((change, index) => <li key={index} className={styles.change}>
        <h2>{change.operation}</h2>
        {change.records.length === 0 ? <p className={styles.muted}>Changes nothing as Travel is now.</p> : change.records.map((record, recordIndex) => <div key={recordIndex} className={styles.record}>
          <p><span className={`${styles.action} ${styles[record.action]}`}>{record.action}</span> {record.record}</p>
          {/* Each photo it adds, changes or deletes, while there is still a decision to make. Stored photos are already resized. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {record.photo && proposal.status === "pending" && <img className={styles.photo} src={`/api/ai-proposal-images/${proposal.id}/${record.photo}`} alt={PHOTO_ALT[record.action]} loading="lazy" decoding="async" width={240} height={160} />}
          {record.fields.length > 0 && <table className={styles.fields}>
            <thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
            <tbody>{record.fields.map((field) => <tr key={field.name}><th scope="row">{field.name}</th><td>{field.before ?? <span className={styles.none}>None</span>}</td><td>{field.after ?? <span className={styles.none}>None</span>}</td></tr>)}</tbody>
          </table>}
        </div>)}
      </li>)}
    </ol>
    {proposal.status === "pending" && <AiProposalDecision proposalId={proposal.id} digest={proposal.digest} />}
  </main>;
}

/** What has become of the proposal, or, while it waits, what deciding does. */
function Outcome({ proposal }: { proposal: AiProposal }) {
  const decided = proposal.decidedAt === null ? "" : formatMoment(proposal.decidedAt);
  switch (proposal.status) {
    case "pending": return <p className={styles.notice}>Review every change below. Approving makes all of them exactly as shown, or none if Travel has changed since; rejecting changes nothing. This proposal expires {formatMoment(proposal.expiresAt)}.</p>;
    case "applied": return <p className={styles.notice}>Approved {decided}. Every change below was made.</p>;
    case "rejected": return <p className={styles.notice}>Rejected {decided}. Nothing was changed.</p>;
    case "failed": return <p className="form-error" role="alert">Approving failed {decided}: {proposal.error} Nothing was changed.</p>;
    case "expired": return <p className={styles.notice}>Expired {formatMoment(proposal.expiresAt)} without a decision. Nothing was changed.</p>;
  }
}
