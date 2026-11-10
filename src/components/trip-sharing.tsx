"use client";

import { UserMinus } from "lucide-react";
import type { TripAccess, TripMember } from "@/lib/types";
import styles from "./trip-sharing.module.css";

/** How a person is named on screen: their Google name once they have signed in, otherwise their email. */
export function memberLabel(member: TripMember): string {
  return member.name ?? member.email;
}

/** The owner's Share dialog: who can open the trip, a way to remove each person, and a field to add one more Google account. */
export default function TripSharing({ access, busy, onRemove }: {
  access: Extract<TripAccess, { role: "owner" }>;
  busy: boolean;
  onRemove: (member: TripMember) => void;
}) {
  return <>
    <p className={`${styles.description} wide`}>People you share this trip with can see and change everything in it: destinations, travel, ideas, budgets, photos and At home items. Only you can delete the trip or change who has access. Travel doesn&apos;t send invitations, so let them know.</p>
    <section className="wide" aria-labelledby="trip-access-heading">
      <h3 id="trip-access-heading" className={styles.heading}>Who has access</h3>
      <ul className={styles.people}>
        <li className={styles.person}><Person member={access.owner} /><span className={styles.role}>Owner</span></li>
        {access.sharedWith.map((member) => <li key={member.email} className={styles.person}><Person member={member} />
          <button type="button" className="text-button" disabled={busy} onClick={() => onRemove(member)} aria-label={`Remove ${member.email}`}><UserMinus size={14} aria-hidden="true" />Remove</button></li>)}
      </ul>
      {access.sharedWith.length === 0 && <p className={styles.description}>Only you can open this trip.</p>}
    </section>
    <label className="field wide"><span>Share with</span>
      <input name="email" type="email" required maxLength={254} autoComplete="off" spellCheck={false} placeholder="Their Google account's email address" disabled={busy} autoFocus />
      <small>They&apos;ll find this trip in their list when they sign in to Travel with that Google account, even if they never have before.</small></label>
  </>;
}

/** Their name and email, or the email alone until they sign in with Google. */
function Person({ member }: { member: TripMember }) {
  return <span className={styles.identity}>{member.name ? <><span className={styles.name}>{member.name}</span><span className={styles.email}>{member.email}</span></> : <span className={styles.name}>{member.email}</span>}</span>;
}
