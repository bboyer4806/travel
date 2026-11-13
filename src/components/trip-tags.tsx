"use client";

import { Check, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { alreadyTagged, MAX_TAG_LENGTH, tagKey } from "@/lib/trip-tags";
import styles from "./trip-tags.module.css";

/** A trip's tags on its card in the trip list. A trip without tags shows nothing. */
export function TripTagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return <ul className={`${styles.tags} ${styles.cardTags}`} aria-label="Tags">{tags.map((tag) => <li key={tag} className={styles.tag}>{tag}</li>)}</ul>;
}

/**
 * A trip's tags on its page, each with a remove button, and a field that adds a new tag or reuses one from `available`,
 * the tags on every trip the account can open. `onAdd` resolves to whether the tag was saved, which empties the field.
 */
export function TripTagsEditor({ tags, available, busy, onAdd, onRemove }: {
  tags: string[];
  available: string[];
  busy: boolean;
  onAdd: (name: string) => Promise<boolean>;
  onRemove: (name: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const suggestions = useId();
  const own = new Map(tags.map((tag) => [tagKey(tag), tag]));
  // A tag the trip already has makes the field invalid, so the browser says so beside it rather than saving.
  const repeated = own.get(tagKey(draft));
  useEffect(() => { field.current?.setCustomValidity(repeated ? alreadyTagged(repeated) : ""); }, [repeated]);
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await onAdd(draft)) setDraft("");
  }
  return <div className={styles.editor}>
    {tags.length > 0 && <ul className={styles.tags} aria-label="Tags">{tags.map((tag) => <li key={tag} className={styles.tag}>{tag}
      <button type="button" className={styles.remove} aria-label={`Remove tag ${tag}`} disabled={busy} onClick={() => onRemove(tag)}><X size={12} aria-hidden="true" /></button></li>)}</ul>}
    {/* The field stays focusable while a tag saves, so the next one can follow. */}
    <form className={styles.add} onSubmit={add}>
      <input ref={field} value={draft} onChange={(event) => setDraft(event.target.value)} readOnly={busy} required maxLength={MAX_TAG_LENGTH} list={suggestions} autoComplete="off" placeholder="Add a tag" aria-label="Add a tag" />
      <datalist id={suggestions}>{available.filter((tag) => !own.has(tagKey(tag))).map((tag) => <option key={tag} value={tag} />)}</datalist>
      <button className="button secondary small" disabled={busy}><Plus size={14} aria-hidden="true" />Add</button>
    </form>
  </div>;
}

/**
 * The trip list's tag filter: every tag on the account's trips, any number of them selected. Only trips with every
 * selected tag show. Clearing keeps the search.
 */
export function TripTagFilter({ tags, selected, onToggle, onClear }: {
  tags: string[];
  selected: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
}) {
  const label = useId();
  return <div className={styles.filter} role="group" aria-labelledby={label}>
    <span id={label} className={styles.filterLabel}>Filter by tag</span>
    {tags.map((tag) => {
      const on = selected.includes(tag);
      return <button key={tag} type="button" className={styles.filterTag} aria-pressed={on} onClick={() => onToggle(tag)}>{on && <Check size={12} aria-hidden="true" />}{tag}</button>;
    })}
    {selected.length > 0 && <button type="button" className="text-button" onClick={onClear}>Clear tag filters</button>}
  </div>;
}
