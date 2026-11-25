"use client";

import { Luggage, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { byCategory, PACKING_CATEGORIES, PACKING_CATEGORY_LABELS, packingProgress, type PackingReview } from "@/lib/packing";
import type { PackingItem } from "@/lib/types";
import styles from "./packing-list.module.css";

/** How many to pack, after an item's name: shown only above 1, read as its quantity. */
function Quantity({ quantity }: { quantity: number }) {
  return quantity > 1 ? <span className={styles.quantity}><span className="sr-only">, quantity </span><span aria-hidden="true">× </span>{quantity}</span> : null;
}

/**
 * A trip's Packing list (TRA-18), one list for everyone who can open the trip: how much of it is packed, then its items
 * by category, each with a checkbox that marks it packed or not packed at once, and its edit and delete buttons. A trip
 * without items explains the list and offers recommendations or an item of one's own. `onPack` is given the checkbox,
 * which shows what is saved and keeps focus once the page shows the change.
 */
export default function PackingList({ items, busy, onRecommend, onAdd, onEdit, onDelete, onPack }: {
  items: PackingItem[];
  busy: boolean;
  onRecommend: () => void;
  onAdd: () => void;
  onEdit: (item: PackingItem) => void;
  onDelete: (item: PackingItem) => void;
  onPack: (item: PackingItem, control: HTMLInputElement) => void;
}) {
  const progress = packingProgress(items);
  return <section className={styles.section} aria-labelledby="packing-heading">
    <div className="section-heading"><div><p className="eyebrow">BEFORE YOU GO</p><h2 id="packing-heading">Packing list</h2></div>
      <div className={styles.actions}>
        <button type="button" className="button secondary small" onClick={onRecommend} disabled={busy}><Sparkles size={16} aria-hidden="true" />Recommend items</button>
        <button type="button" className="button secondary small" onClick={onAdd} disabled={busy}><Plus size={16} aria-hidden="true" />Add item</button>
      </div>
    </div>
    <p className={styles.description}>One list for everyone on this trip, with quantities for the whole party. Check items off as you pack them.</p>
    {items.length === 0 ? <div className={`empty-state ${styles.empty}`}><Luggage size={28} strokeWidth={1.4} aria-hidden="true" /><h3>Nothing to pack yet.</h3>
      <p>Recommend items from this trip&apos;s destinations, dates, nights, weather and activities, and choose which to add. Or add your own.</p>
      <div className={styles.emptyActions}><button type="button" className="button primary small" onClick={onRecommend} disabled={busy}><Sparkles size={15} aria-hidden="true" />Recommend items</button><button type="button" className="text-button" onClick={onAdd} disabled={busy}><Plus size={15} aria-hidden="true" />Add your own item</button></div>
    </div> : <>
      <div className={styles.progress}>
        <p id="packing-progress" className={styles.progressText}><span><strong>{progress.packed} of {progress.total}</strong> packed</span><span>{progress.percent}%</span></p>
        <progress className={styles.bar} max={progress.total} value={progress.packed} aria-labelledby="packing-progress" />
      </div>
      {byCategory(items).map(({ category, items: group }) => <div key={category} className={styles.group}>
        <div className={styles.groupHeading}><h3>{PACKING_CATEGORY_LABELS[category]}</h3><span>{packingProgress(group).packed} of {group.length} packed</span></div>
        <ul className={styles.items}>{group.map((item) => <li key={item.id} className={item.packed ? `${styles.row} ${styles.packed}` : styles.row}>
          <label className={styles.check}><input type="checkbox" checked={item.packed} disabled={busy} onChange={(event) => onPack(item, event.currentTarget)} /><span className={styles.text}><span className={styles.name}>{item.name}</span><Quantity quantity={item.quantity} /></span></label>
          <div className={styles.tools}><button type="button" className="icon-button" aria-label={`Edit ${item.name}`} disabled={busy} onClick={() => onEdit(item)}><Pencil size={15} aria-hidden="true" /></button><button type="button" className="icon-button" aria-label={`Delete ${item.name}`} disabled={busy} onClick={() => onDelete(item)}><Trash2 size={15} aria-hidden="true" /></button></div>
        </li>)}</ul>
      </div>)}
    </>}
  </section>;
}

/** A packing item editor's fields (TRA-18): its name, its category, which a new item chooses, and its quantity, 1 to start. */
export function PackingItemFields({ item, disabled }: { item?: PackingItem; disabled: boolean }) {
  return <>
    <label className="field wide"><span>Name</span><input name="name" defaultValue={item?.name} required maxLength={160} placeholder="Swimsuit, phone charger, or anything else" disabled={disabled} /></label>
    <label className="field"><span>Category</span><select name="category" className={styles.select} defaultValue={item?.category ?? ""} required disabled={disabled}>
      <option value="" disabled>Choose a category</option>
      {PACKING_CATEGORIES.map((category) => <option key={category} value={category}>{PACKING_CATEGORY_LABELS[category]}</option>)}
    </select></label>
    <label className="field"><span>Quantity</span><input name="quantity" type="number" inputMode="numeric" min="1" max="9999" step="1" required defaultValue={item?.quantity ?? 1} disabled={disabled} /><small>For the whole party.</small></label>
  </>;
}

/**
 * A review of packing recommendations (TRA-18): what was assumed, then each new recommendation by category, checked to
 * start, with its quantity and why it is recommended, and what is already on the list, which adding leaves as it is.
 * Each checkbox is `recommended`, valued by the ID its item is added under.
 */
export function PackingReviewFields({ review, disabled }: { review: PackingReview; disabled: boolean }) {
  return <>
    <p className="helper wide">Recommended from this trip&apos;s destinations, dates, nights, weather, activities and travel. Uncheck anything you don&apos;t need: only checked items are added, and nothing already on the list changes.</p>
    {review.assumptions.length > 0 && <div className={`wide ${styles.assumptions}`}><h3>Assumptions</h3><ul>{review.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></div>}
    {review.items.length === 0 ? <p className={`wide ${styles.allSaved}`}>Everything recommended is already on the list.</p>
      : byCategory(review.items).map(({ category, items }) => <fieldset key={category} className={`wide ${styles.reviewGroup}`}><legend>{PACKING_CATEGORY_LABELS[category]}</legend>
        {items.map((item) => <label key={item.id} className={styles.reviewItem}><input type="checkbox" name="recommended" value={item.id} defaultChecked disabled={disabled} />
          <span>{item.name}<Quantity quantity={item.quantity} />{item.reasons.length > 0 && <small>{item.reasons.join("; ")}</small>}</span></label>)}
      </fieldset>)}
    {review.onList.length > 0 && <p className="helper wide">Already on the list, and left as they are: {review.onList.map((item) => item.name).join(", ")}.</p>}
  </>;
}
