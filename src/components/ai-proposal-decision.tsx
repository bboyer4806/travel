"use client";
import { useActionState } from "react";
import { decideProposal } from "@/app/ai/actions";
import styles from "@/app/ai/ai.module.css";

/** Approve and Reject for a pending proposal. The digest names the proposal as shown, so a decision applies to nothing else. */
export default function AiProposalDecision({ proposalId, digest }: { proposalId: string; digest: string }) {
  const [state, action, pending] = useActionState(decideProposal, null);
  return <form action={action} className={styles.decision}>
    <input type="hidden" name="proposalId" value={proposalId} />
    <input type="hidden" name="digest" value={digest} />
    {state?.error && <p className="form-error" role="alert">{state.error}</p>}
    <div className={styles.actions}>
      <button type="submit" name="decision" value="approve" className="button primary" disabled={pending}>Approve every change</button>
      <button type="submit" name="decision" value="reject" className="button secondary" disabled={pending}>Reject</button>
    </div>
  </form>;
}
