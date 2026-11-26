"use client";

import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Church as ChurchIcon, ExternalLink, EyeOff, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import type { GalleryDraft } from "@/lib/gallery-draft";
import { CAROUSEL_CARD, DIALOG, photoSizes, type FrameWidths } from "@/lib/photo-sizes";
import { CandidateGallery, CandidateGalleryEditor, largeUrl, photoUrl } from "./candidate-gallery";
import { Carousel } from "./destination-ideas";
import { useFocusAfter } from "./focus-after";
import { CoordinatesDetail, PlaceLocationFields } from "./place-location";
import type { Church, MassTime } from "@/lib/types";
import { randomUuid } from "@/lib/uuid";
import styles from "./churches.module.css";
import ideaStyles from "./destination-ideas.module.css";

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

/**
 * A destination's Churches on its card, on a trip's page or in Destinations, laid out as its Hotels, Activities and
 * Restaurants are (TRA-182), and named for screen readers by its destination's `label`. Its heading shows how many
 * churches it has and opens and closes the section, which starts open each time the page loads; opening and closing
 * saves nothing. Add church and Hide Church show beside it either way. Below it come the stay's `sundays`, in a trip,
 * then a carousel of the churches, or a message without any, and a link to the destination's Church page, `href`, where
 * churches are edited and deleted. Selecting a church's card shows its details.
 */
export function ChurchSection({ churches, label, href, hideId, busy, sundays, onAdd, onHide, onView, like }: {
  /** The destination's churches, by name, as its Church page lists them. */
  churches: Church[];
  label: string;
  href: string;
  /** Hide Church's ID, which Show Church shares, so saving either focuses the other. */
  hideId: string;
  busy: boolean;
  sundays?: ReactNode;
  onAdd: () => void;
  /** Hides Church, from Hide Church, `control`. */
  onHide: (control: HTMLButtonElement) => void;
  onView: (item: Church) => void;
  /** A church's Like (TRA-31). */
  like: (item: Church) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  return <section className={ideaStyles.section} aria-label={"Churches in " + label}>
    <div className="section-heading">
      <h4><button type="button" className={ideaStyles.toggle} aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded((open) => !open)}>Churches<span className={ideaStyles.count}>({churches.length})</span><ChevronDown size={18} aria-hidden="true" /></button></h4>
      <div className={ideaStyles.actions}>
        <button type="button" className="button secondary small" disabled={busy} onClick={onAdd}><Plus size={15} aria-hidden="true" />Add church<span className="sr-only"> in {label}</span></button>
        <button type="button" id={hideId} className="button secondary small" disabled={busy} onClick={(event) => onHide(event.currentTarget)}><EyeOff size={15} aria-hidden="true" />Hide Church<span className="sr-only"> for {label}</span></button>
      </div>
    </div>
    <div id={contentId} className={ideaStyles.content} hidden={!expanded}>
      {sundays}
      {churches.length ? <Carousel name="churches" items={churches} card={(item) => <ChurchCard item={item} onView={onView} like={like} />} />
        : <p className={ideaStyles.empty}>No churches saved yet.</p>}
      <Link className={"text-button " + ideaStyles.manage} href={href}>Manage churches<span className="sr-only"> in {label}</span></Link>
    </div>
  </section>;
}

/**
 * A church's card in its destination's Churches carousel (TRA-182), as an idea's is in its carousel: its main photo, or
 * the church icon in a frame of the same size, its name, and its denomination when it has one. Its Like sits over the
 * bottom of its photo, beside the card rather than in it, as an idea's does, so selecting the Like shows no details
 * (TRA-31). A church has no star, price or budget selection.
 */
function ChurchCard({ item, onView, like }: { item: Church; onView: (item: Church) => void; like: (item: Church) => ReactNode }) {
  const photo = item.images.find((image) => image.id === item.mainImageId) ?? item.images[0];
  return <>
    <button type="button" className={ideaStyles.card} onClick={() => onView(item)}>
      <span className={ideaStyles.photo}>
        {/* Stored photos are resized and optimized on upload. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photo ? <img src={photoUrl(item.id, photo, "church")} {...photoSizes(photoUrl(item.id, photo, "church"), largeUrl(item.id, photo, "church"), photo.widths, CAROUSEL_CARD)} alt="" loading="lazy" decoding="async" width={400} height={300} /> : <ChurchIcon size={30} strokeWidth={1.3} aria-hidden="true" />}
      </span>
      <span className={styles.cardText}>
        <span className={ideaStyles.name}>{item.name}</span>
        {item.denomination && <span className={ideaStyles.description}>{item.denomination}</span>}
      </span>
    </button>
    <span className={ideaStyles.likeSlot}>{like(item)}</span>
  </>;
}

/**
 * A destination's churches on its Church page, where they are the page. Each church's name is a heading at
 * `headingLevel`, below the section that lists them, and its Mass times one level lower (TRA-95). `photoFrame` is how
 * wide each church's photo is (TRA-154). Each church's Like, `like`, is beside its Edit and Delete (TRA-31).
 */
export function ChurchOptions({ items, headingLevel, photoFrame, busy, onAdd, onEdit, onDelete, like }: {
  items: Church[]; headingLevel: 2 | 3 | 4 | 5; photoFrame: FrameWidths; busy: boolean; onAdd: () => void; onEdit: (item: Church) => void; onDelete: (item: Church) => void; like: (item: Church) => ReactNode;
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
    <CandidateGallery candidate={item} frame={photoFrame} imageKind="church" browse />
    <div className="idea-top"><span className="selection-tag">Church option</span><div className="idea-tools">
      {like(item)}
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
 * A church's saved details, read only, as an idea's details show theirs: from its card in its destination's Churches
 * carousel (TRA-182), its marker on its destination's map, or its place under Not on the map (TRA-130). Its name is the
 * dialog's title.
 */
export function ChurchDetails({ item }: { item: Church }) {
  return <dl className={ideaStyles.details}>
    <div><dt>Location or address</dt><dd>{item.address || "Not added"}</dd></div>
    <div><dt>Coordinates</dt><dd><CoordinatesDetail coordinates={item.coordinates} /></dd></div>
    <div><dt>Denomination</dt><dd>{item.denomination || "Not added"}</dd></div>
    <div><dt>Website</dt><dd>{item.url ? <a className={styles.website} href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" />Church website<span className="sr-only"> for {item.name} (opens in a new tab)</span></a> : "Not added"}</dd></div>
    <div><dt>Mass times</dt><dd>{item.massTimes.length ? <dl className={styles.detailTimes}>{item.massTimes.map((entry) => <div key={entry.id}><dt>{entry.day}</dt><dd>{entry.time}</dd></div>)}</dl> : "Mass times unknown"}</dd></div>
    <div><dt>Church photos</dt><dd>{item.images.length ? <CandidateGallery candidate={item} frame={DIALOG} imageKind="church" browse /> : "Not added"}</dd></div>
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
    <PlaceLocationFields key={item?.id} label="Location or address (optional)" placeholder="Street address or neighborhood" address={item?.address ?? ""} coordinates={item?.coordinates ?? null} disabled={busy} />
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
