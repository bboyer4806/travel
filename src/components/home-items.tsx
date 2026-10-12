"use client";

import { Check, CheckCircle2, House, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { formatMoney } from "@/lib/budget";
import type { HomeItem } from "@/lib/types";
import styles from "./home-items.module.css";

export default function HomeItems({ items, busy, onAdd, onEdit, onDelete, onComplete }: {
  items: HomeItem[];
  busy: boolean;
  onAdd: () => void;
  onEdit: (item: HomeItem) => void;
  onDelete: (item: HomeItem) => void;
  onComplete: (item: HomeItem) => void;
}) {
  const completedCount = items.filter((item) => item.completed).length;
  return <section className={styles.section} aria-labelledby="at-home-heading">
    <div className="section-heading"><div><p className="eyebrow">WHILE YOU&apos;RE AWAY</p><h2 id="at-home-heading">At home</h2></div><button type="button" className="button secondary small" onClick={onAdd} disabled={busy}><Plus size={16} aria-hidden="true" />Add item</button></div>
    <p className={styles.description}>Keep track of house sitting, babysitting, pet care, and other things to arrange at home.</p>
    {items.length === 0 ? <div className={`empty-state ${styles.empty}`}><House size={28} strokeWidth={1.4} aria-hidden="true" /><h3>A little planning for home, too.</h3><p>Add a task or expense for this trip. Prices are optional.</p><button type="button" className="text-button" onClick={onAdd} disabled={busy}><Plus size={15} aria-hidden="true" />Add your first item</button></div>
      : <>
        <p className={styles.progress}>{completedCount} of {items.length} {items.length === 1 ? "item" : "items"} complete</p>
        <div className={styles.list}>{items.map((item) => <article key={item.id} className={`${styles.card}${item.completed ? ` ${styles.completed}` : ""}`}>
          <div className={styles.cardHeading}>
            <div className={styles.title}><span className={`${styles.status}${item.completed ? ` ${styles.done}` : ""}`}>{item.completed ? <><CheckCircle2 size={12} aria-hidden="true" />Complete</> : "To do"}</span><h3>{item.name}</h3></div>
            <div className={styles.tools}><button type="button" className="icon-button" aria-label={`Edit ${item.name}`} disabled={busy} onClick={() => onEdit(item)}><Pencil size={15} aria-hidden="true" /></button><button type="button" className="icon-button" aria-label={`Delete ${item.name}`} disabled={busy} onClick={() => onDelete(item)}><Trash2 size={15} aria-hidden="true" /></button></div>
          </div>
          {item.notes && <p className={styles.notes}>{item.notes}</p>}
          <div className={styles.bottom}><div><span className={item.priceCents === null ? styles.noPrice : styles.price}>{item.priceCents === null ? "No price added" : formatMoney(item.priceCents)}</span>{item.priceCents !== null && <small>Included in the trip estimate</small>}</div><button type="button" className={`button ${item.completed ? "secondary" : "selected-button"} small`} aria-label={`${item.completed ? "Reopen" : "Mark complete:"} ${item.name}`} disabled={busy} onClick={() => onComplete(item)}>{item.completed ? <><RotateCcw size={14} aria-hidden="true" />Reopen</> : <><Check size={14} aria-hidden="true" />Mark complete</>}</button></div>
        </article>)}</div>
        <p className="helper">Any prices you add stay in the trip estimate, including for completed items.</p>
      </>}
  </section>;
}
