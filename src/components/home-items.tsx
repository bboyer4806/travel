"use client";

import { House, Pencil, Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/money";
import type { HomeItem } from "@/lib/types";
import styles from "./home-items.module.css";

export default function HomeItems({ items, busy, onAdd, onEdit, onDelete }: {
  items: HomeItem[];
  busy: boolean;
  onAdd: () => void;
  onEdit: (item: HomeItem) => void;
  onDelete: (item: HomeItem) => void;
}) {
  return <section className={styles.section} aria-labelledby="at-home-heading">
    <div className="section-heading"><div><p className="eyebrow">WHILE YOU&apos;RE AWAY</p><h2 id="at-home-heading">At home</h2></div><button type="button" className="button secondary small" onClick={onAdd} disabled={busy}><Plus size={16} aria-hidden="true" />Add item</button></div>
    <p className={styles.description}>Keep track of house sitting, babysitting, pet care, and other things to arrange at home.</p>
    {items.length === 0 ? <div className={`empty-state ${styles.empty}`}><House size={28} strokeWidth={1.4} aria-hidden="true" /><h3>A little planning for home, too.</h3><p>Add a task or expense for this trip. Prices are optional.</p><button type="button" className="text-button" onClick={onAdd} disabled={busy}><Plus size={15} aria-hidden="true" />Add your first item</button></div>
      : <>
        {/* Items aren't marked done (TRA-146): each shows its name, notes and price. */}
        <div className={styles.list}>{items.map((item) => <article key={item.id} className={styles.card}>
          <div className={styles.cardHeading}>
            <h3 className={styles.title}>{item.name}</h3>
            <div className={styles.tools}><button type="button" className="icon-button" aria-label={`Edit ${item.name}`} disabled={busy} onClick={() => onEdit(item)}><Pencil size={15} aria-hidden="true" /></button><button type="button" className="icon-button" aria-label={`Delete ${item.name}`} disabled={busy} onClick={() => onDelete(item)}><Trash2 size={15} aria-hidden="true" /></button></div>
          </div>
          {item.notes && <p className={styles.notes}>{item.notes}</p>}
          <div className={styles.bottom}><span className={item.priceCents === null ? styles.noPrice : styles.price}>{item.priceCents === null ? "No price added" : formatCurrency(item.priceCents, "USD")}</span>{item.priceCents !== null && <small>Included in the trip estimate</small>}</div>
        </article>)}</div>
        <p className="helper">Any prices you add are included in the trip estimate.</p>
      </>}
  </section>;
}
