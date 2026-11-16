"use client";

import { useRef } from "react";
import { Church as ChurchIcon, ExternalLink, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import type { GalleryDraft } from "@/lib/gallery-draft";
import { CandidateGallery, CandidateGalleryEditor } from "./candidate-gallery";
import { useFocusAfter } from "./focus-after";
import type { Church, MassTime } from "@/lib/types";
import { randomUuid } from "@/lib/uuid";
import styles from "./churches.module.css";
import ideaStyles from "./destination-ideas.module.css";

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

/**
 * A destination's churches. Each church's name is a heading at `headingLevel`, below the section that lists them, and
 * its Mass times one level lower (TRA-95).
 */
export function ChurchOptions({ items, headingLevel, busy, onAdd, onEdit, onDelete }: {
  items: Church[]; headingLevel: 2 | 3 | 4 | 5; busy: boolean; onAdd: () => void; onEdit: (item: Church) => void; onDelete: (item: Church) => void;
}) {
  const Heading = HEADINGS[headingLevel - 1];
  const TimesHeading = HEADINGS[headingLevel];
  if (!items.length) return <div className="empty-state ideas-empty">
    <ChurchIcon size={34} strokeWidth={1.3} aria-hidden="true" />
    <Heading className={styles.emptyHeading}>Find a church for your visit.</Heading>
    <p>Save church options and Mass times here.<br />You can add details and photos later.</p>
    <button type="button" className="button secondary" onClick={onAdd} disabled={busy}><Plus size={16} />Add church</button>
  </div>;
  return <div className="ideas-grid">{items.map((item) => <article className="idea-card" key={item.id}>
    <CandidateGallery candidate={item} imageKind="church" />
    <div className="idea-top"><span className="selection-tag">Church option</span><div className="idea-tools">
      <button type="button" className="icon-button" aria-label={`Edit ${item.name}`} onClick={() => onEdit(item)} disabled={busy}><Pencil size={16} /></button>
      <button type="button" className="icon-button" aria-label={`Delete ${item.name}`} onClick={() => onDelete(item)} disabled={busy}><Trash2 size={16} /></button>
    </div></div>
    <Heading className={styles.name}>{item.name}</Heading>
    {item.address && <p className="idea-address"><MapPin size={15} aria-hidden="true" />{item.address}</p>}
    {item.denomination && <p className={styles.denomination}>{item.denomination}</p>}
    {item.url && <a className={styles.website} href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" />Church website<span className="sr-only"> for {item.name} (opens in a new tab)</span></a>}
    <div className={styles.times}><TimesHeading className={styles.timesHeading}>Mass times</TimesHeading>
      {item.massTimes.length ? <dl>{item.massTimes.map((entry) => <div key={entry.id}><dt>{entry.day}</dt><dd>{entry.time}</dd></div>)}</dl> : <p className={styles.unknown}>Mass times unknown</p>}
    </div>
  </article>)}</div>;
}

/**
 * A church's saved details, read only, as an idea's details show theirs: from its marker on its destination's map, or its
 * place under Not on the map (TRA-130). Its name is the dialog's title.
 */
export function ChurchDetails({ item }: { item: Church }) {
  return <dl className={ideaStyles.details}>
    <div><dt>Location or address</dt><dd>{item.address || "Not added"}</dd></div>
    <div><dt>Denomination</dt><dd>{item.denomination || "Not added"}</dd></div>
    <div><dt>Website</dt><dd>{item.url ? <a className={styles.website} href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" />Church website<span className="sr-only"> for {item.name} (opens in a new tab)</span></a> : "Not added"}</dd></div>
    <div><dt>Mass times</dt><dd>{item.massTimes.length ? <dl className={styles.detailTimes}>{item.massTimes.map((entry) => <div key={entry.id}><dt>{entry.day}</dt><dd>{entry.time}</dd></div>)}</dl> : "Mass times unknown"}</dd></div>
    <div><dt>Church photos</dt><dd>{item.images.length ? <CandidateGallery candidate={item} imageKind="church" /> : "Not added"}</dd></div>
  </dl>;
}

export function ChurchEditor({ item, massTimes, onTimesChange, gallery, onGalleryChange, busy }: {
  item?: Church; massTimes: MassTime[]; onTimesChange: (times: MassTime[]) => void;
  gallery: GalleryDraft; onGalleryChange: (draft: GalleryDraft) => void; busy: boolean;
}) {
  const focusAfter = useFocusAfter();
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const update = (id: string, field: "day" | "time", value: string) => onTimesChange(massTimes.map((entry) => entry.id === id ? { ...entry, [field]: value } : entry));
  /** Removes a time and focuses the next time's Remove, or Add Mass time after the last. */
  function remove(index: number) {
    const next = massTimes[index + 1];
    focusAfter(() => next ? removeButtons.current.get(next.id) : addButton.current);
    onTimesChange(massTimes.filter((_, position) => position !== index));
  }
  return <>
    <label className="field wide"><span>Name</span><input name="name" defaultValue={item?.name} required maxLength={160} disabled={busy} placeholder="Church name" /></label>
    <label className="field wide"><span>Location or address (optional)</span><input name="address" defaultValue={item?.address} maxLength={500} disabled={busy} placeholder="Street address or neighborhood" /></label>
    <label className="field wide"><span>Denomination (optional)</span><input name="denomination" defaultValue={item?.denomination} maxLength={160} disabled={busy} placeholder="For example, Roman Catholic" /></label>
    <label className="field wide"><span>Website (optional)</span><input name="url" type="url" defaultValue={item?.url} maxLength={2048} disabled={busy} placeholder="https://" /></label>
    <fieldset className={`${styles.editor} wide`} disabled={busy}>
      <legend>Mass times (optional)</legend>
      <p className="helper">Add a day or date for each time, using the church&apos;s local time. Leave the list empty if times are unknown.</p>
      {massTimes.map((entry, index) => <div className={styles.timeRow} key={entry.id}>
        <label className="field"><span>Day or date ({index + 1})</span><input value={entry.day} onChange={(event) => update(entry.id, "day", event.target.value)} required maxLength={120} placeholder="Sunday or May 2, 2027" /></label>
        <label className="field"><span>Mass time ({index + 1})</span><input value={entry.time} onChange={(event) => update(entry.id, "time", event.target.value)} required maxLength={120} placeholder="9:00 AM" /></label>
        <button type="button" className="icon-button" aria-label={`Remove Mass time ${index + 1}`} onClick={() => remove(index)}
          ref={(button) => { if (button) removeButtons.current.set(entry.id, button); else removeButtons.current.delete(entry.id); }}><Trash2 size={16} /></button>
      </div>)}
      <button type="button" ref={addButton} className="button secondary small" disabled={busy || massTimes.length >= 30} onClick={() => onTimesChange([...massTimes, { id: randomUuid(), day: "", time: "" }])}><Plus size={15} />Add Mass time</button>
    </fieldset>
    <CandidateGalleryEditor candidate={item} subject="church" imageKind="church" draft={gallery} onChange={onGalleryChange} disabled={busy} />
  </>;
}
