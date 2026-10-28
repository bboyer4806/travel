"use client";

import { Church as ChurchIcon, ExternalLink, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { CandidateGallery, CandidateGalleryEditor, type CandidateGalleryDraft } from "./candidate-gallery";
import type { Church, MassTime } from "@/lib/types";
import styles from "./churches.module.css";

export function ChurchOptions({ items, busy, onAdd, onEdit, onDelete }: {
  items: Church[]; busy: boolean; onAdd: () => void; onEdit: (item: Church) => void; onDelete: (item: Church) => void;
}) {
  if (!items.length) return <div className="empty-state ideas-empty">
    <ChurchIcon size={34} strokeWidth={1.3} aria-hidden="true" />
    <h2>Find a church for your visit.</h2>
    <p>Save church options and Mass times here.<br />You can add details and photos later.</p>
    <button type="button" className="button secondary" onClick={onAdd} disabled={busy}><Plus size={16} />Add church</button>
  </div>;
  return <div className="ideas-grid">{items.map((item) => <article className="idea-card" key={item.id}>
    <CandidateGallery candidate={item} imageKind="church" />
    <div className="idea-top"><span className="selection-tag">Church option</span><div className="idea-tools">
      <button type="button" className="icon-button" aria-label={`Edit ${item.name}`} onClick={() => onEdit(item)} disabled={busy}><Pencil size={16} /></button>
      <button type="button" className="icon-button" aria-label={`Delete ${item.name}`} onClick={() => onDelete(item)} disabled={busy}><Trash2 size={16} /></button>
    </div></div>
    <h2>{item.name}</h2>
    {item.address && <p className="idea-address"><MapPin size={15} aria-hidden="true" />{item.address}</p>}
    {item.denomination && <p className={styles.denomination}>{item.denomination}</p>}
    {item.url && <a className={styles.website} href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" />Church website<span className="sr-only"> for {item.name} (opens in a new tab)</span></a>}
    <div className={styles.times}><h3>Mass times</h3>
      {item.massTimes.length ? <dl>{item.massTimes.map((entry) => <div key={entry.id}><dt>{entry.day}</dt><dd>{entry.time}</dd></div>)}</dl> : <p className={styles.unknown}>Mass times unknown</p>}
    </div>
  </article>)}</div>;
}

export function ChurchEditor({ item, massTimes, onTimesChange, gallery, onGalleryChange, busy }: {
  item?: Church; massTimes: MassTime[]; onTimesChange: (times: MassTime[]) => void;
  gallery: CandidateGalleryDraft; onGalleryChange: (draft: CandidateGalleryDraft) => void; busy: boolean;
}) {
  const update = (id: string, field: "day" | "time", value: string) => onTimesChange(massTimes.map((entry) => entry.id === id ? { ...entry, [field]: value } : entry));
  return <>
    <label className="field wide"><span>Name</span><input name="name" defaultValue={item?.name} required maxLength={160} autoFocus disabled={busy} placeholder="Church name" /></label>
    <label className="field wide"><span>Location or address (optional)</span><input name="address" defaultValue={item?.address} maxLength={500} disabled={busy} placeholder="Street address or neighborhood" /></label>
    <label className="field wide"><span>Denomination (optional)</span><input name="denomination" defaultValue={item?.denomination} maxLength={160} disabled={busy} placeholder="For example, Roman Catholic" /></label>
    <label className="field wide"><span>Website (optional)</span><input name="url" type="url" defaultValue={item?.url} maxLength={2048} disabled={busy} placeholder="https://" /></label>
    <fieldset className={`${styles.editor} wide`} disabled={busy}>
      <legend>Mass times (optional)</legend>
      <p className="helper">Add a day or date for each time, using the church&apos;s local time. Leave the list empty if times are unknown.</p>
      {massTimes.map((entry, index) => <div className={styles.timeRow} key={entry.id}>
        <label className="field"><span>Day or date ({index + 1})</span><input value={entry.day} onChange={(event) => update(entry.id, "day", event.target.value)} required maxLength={120} placeholder="Sunday or May 2, 2027" /></label>
        <label className="field"><span>Mass time ({index + 1})</span><input value={entry.time} onChange={(event) => update(entry.id, "time", event.target.value)} required maxLength={120} placeholder="9:00 AM" /></label>
        <button type="button" className="icon-button" aria-label={`Remove Mass time ${index + 1}`} onClick={() => onTimesChange(massTimes.filter((time) => time.id !== entry.id))}><Trash2 size={16} /></button>
      </div>)}
      <button type="button" className="button secondary small" disabled={busy || massTimes.length >= 30} onClick={() => onTimesChange([...massTimes, { id: crypto.randomUUID(), day: "", time: "" }])}><Plus size={15} />Add Mass time</button>
    </fieldset>
    <CandidateGalleryEditor candidate={item} subject="church" imageKind="church" draft={gallery} onChange={onGalleryChange} disabled={busy} />
  </>;
}
