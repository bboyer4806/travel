"use client";

import { CalendarDays, Check, Pencil, Plus } from "lucide-react";
import { useId } from "react";
import { BEST_TIME_NOTE_LENGTH, hasBestTime, type BestTime } from "@/lib/trip-best-time";
import { MONTHS, type Month } from "@/lib/typical-weather";
import styles from "./trip-best-time.module.css";

/**
 * A trip's Best time to go (TRA-178), the same for everyone who can open the trip: its recommended months in calendar
 * order, why, and the times to avoid, or what it is for while the trip has none. Its buttons add or edit it. Nothing
 * here changes the trip's dates.
 */
export function BestTimeSection({ bestTime, busy, onEdit }: { bestTime: BestTime; busy: boolean; onEdit: () => void }) {
  const researched = hasBestTime(bestTime);
  return <section className={styles.section} aria-labelledby="best-time-heading">
    <div className="section-heading"><div><p className="eyebrow">THE RIGHT TIME OF YEAR</p><h2 id="best-time-heading">Best time to go</h2></div>
      <button type="button" className="button secondary small" onClick={onEdit} disabled={busy}>{researched ? <Pencil size={15} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{researched ? "Edit best time to go" : "Add best time to go"}</button></div>
    <p className={styles.description}>The months that suit the whole trip, across all of its destinations, and the times to avoid. They never change the trip&apos;s dates.</p>
    {researched ? <dl className={styles.details}>
      <div><dt>Recommended months</dt><dd>{bestTime.months.length > 0
        ? <ul className={styles.months}>{bestTime.months.map((month) => <li key={month}>{month}</li>)}</ul>
        : <span className={styles.none}>No months chosen yet</span>}</dd></div>
      {bestTime.reasons && <div><dt>Why these months</dt><dd className={styles.note}>{bestTime.reasons}</dd></div>}
      {bestTime.avoid && <div><dt>Times to avoid</dt><dd className={styles.note}>{bestTime.avoid}</dd></div>}
    </dl> : <div className={`empty-state ${styles.empty}`}><CalendarDays size={28} strokeWidth={1.4} aria-hidden="true" /><h3>When is the best time to go?</h3>
      <p>Choose the months that suit every destination on this trip, why they suit it, and which times to avoid. Month filters on All trips find the trip by them.</p>
      <button type="button" className="text-button" onClick={onEdit} disabled={busy}><Plus size={15} aria-hidden="true" />Choose the best months</button></div>}
  </section>;
}

/**
 * The Best time to go editor's fields (TRA-178): a checkbox for each month, January to December, any number of them or
 * none, and its two optional notes. Saving sends every month checked, so unchecking them all removes them.
 */
export function BestTimeFields({ bestTime, disabled }: { bestTime: BestTime; disabled: boolean }) {
  return <>
    <fieldset className={"wide " + styles.picker}>
      <legend>Recommended months</legend>
      <div className={styles.choices}>
        {MONTHS.map((month) => <label key={month} className={styles.choice}>
          <input type="checkbox" name="months" value={month} defaultChecked={bestTime.months.includes(month)} disabled={disabled} />{month}
        </label>)}
      </div>
      <small className={styles.hint}>Choose every month that suits the whole trip, across all of its destinations: any of them, all 12, or none.</small>
    </fieldset>
    <label className="field wide"><span>Why these months</span><textarea name="reasons" defaultValue={bestTime.reasons} maxLength={BEST_TIME_NOTE_LENGTH} rows={4} placeholder="Weather, activities, festivals, crowds…" disabled={disabled} /><small>Optional. What makes these months best, such as the weather, activities, festivals and crowds.</small></label>
    <label className="field wide"><span>Times to avoid</span><textarea name="avoid" defaultValue={bestTime.avoid} maxLength={BEST_TIME_NOTE_LENGTH} rows={3} placeholder="Rainy season, holiday crowds…" disabled={disabled} /><small>Optional. Times of year that suit the trip less, and why.</small></label>
    <p className="helper wide">Saving changes only the best time to go, never the trip&apos;s dates, destinations, travel or budget.</p>
  </>;
}

/**
 * All trips' Best time to go filter (TRA-178): the 12 months, any number of them selected. Only trips recommended for at
 * least one selected month show, so none without recommended months does; with none selected it filters nothing.
 * Clearing keeps the search and tag filters.
 */
export function BestMonthFilter({ selected, onToggle, onClear }: { selected: readonly Month[]; onToggle: (month: Month) => void; onClear: () => void }) {
  const label = useId();
  return <div className={styles.filter} role="group" aria-labelledby={label}>
    <span id={label} className={styles.filterLabel}>Best time to go</span>
    <div className={styles.filterMonths}>{MONTHS.map((month) => {
      const on = selected.includes(month);
      // Each month shows its first three letters and is named in full.
      return <button key={month} type="button" className={styles.filterMonth} aria-pressed={on} aria-label={month} onClick={() => onToggle(month)}>{on && <Check size={12} aria-hidden="true" />}{month.slice(0, 3)}</button>;
    })}</div>
    {selected.length > 0 && <button type="button" className="text-button" onClick={onClear}>Clear month filters</button>}
  </div>;
}
