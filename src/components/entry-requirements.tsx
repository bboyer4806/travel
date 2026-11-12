"use client";

import { useId, useState } from "react";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { ResearchLinks, ResearchLinksEditor } from "@/components/research-links";
import { ENTRY_REQUIREMENT_FIELDS, type EntryRequirements } from "@/lib/entry-requirements";
import { formatCalendarDate } from "@/lib/trip-dates";
import type { ResearchLink, TripStop } from "@/lib/types";
import styles from "./entry-requirements.module.css";

type PanelProps = {
  requirements: EntryRequirements | null;
  /** One trip's stay, shown for reference. Outside a trip there is none. */
  stay?: Pick<TripStop, "arrivalDate" | "departureDate" | "nights">;
  disabled: boolean;
  onEdit: () => void;
  onClear: () => void;
};

const reminder = "Manually maintained research. Requirements depend on your passport nationality, purpose of travel, stay length, and circumstances. Verify with official government or embassy sources before travel.";

export function EntryRequirementsPanel({ requirements, stay, disabled, onEdit, onClear }: PanelProps) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  return <section className={styles.panel} aria-label="Entry requirements">
    <div className="section-heading">
      <h4><button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded((open) => !open)}>Entry requirements<ChevronDown size={18} aria-hidden="true" /></button></h4>
      <div className={styles.actions}>
        <button type="button" className="button secondary small" disabled={disabled} onClick={onEdit}>
          {requirements ? <Pencil size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
          {requirements ? "Edit entry requirements" : "Add entry requirements"}
        </button>
        {requirements && <button type="button" className="text-button" disabled={disabled} onClick={onClear}><Trash2 size={14} aria-hidden="true" />Clear</button>}
      </div>
    </div>
    <div id={contentId} className={styles.content} hidden={!expanded}>
      <p className={styles.reminder}>{reminder}</p>
      {stay && <><dl className={styles.schedule} aria-label="Current stay for reference">
        <div><dt>Current arrival</dt><dd>{formatCalendarDate(stay.arrivalDate)}</dd></div>
        <div><dt>Current departure</dt><dd>{formatCalendarDate(stay.departureDate)}</dd></div>
        <div><dt>Stay length</dt><dd>{stay.nights === null ? "Nights not set" : `${stay.nights} ${stay.nights === 1 ? "night" : "nights"}`}</dd></div>
      </dl>
      <p className={styles.hint}>This trip&apos;s stay is shown for reference. Schedule changes do not update this research, which every trip visiting this destination shares.</p></>}
      {!requirements ? <p className={styles.empty}>No entry requirements recorded. Missing or unconfirmed information does not mean there are no requirements.</p> : <>
        <dl className={styles.details}>
          {ENTRY_REQUIREMENT_FIELDS.map((field) => <div key={field.name}><dt>{field.label}</dt><dd>{requirements[field.name] || "Not recorded"}</dd></div>)}
          <div><dt>Last checked</dt><dd>{requirements.lastCheckedDate ? formatCalendarDate(requirements.lastCheckedDate) : "Not checked / unconfirmed"}</dd></div>
        </dl>
        <div className={styles.sources}><h5>Sources</h5>{requirements.sources.length ? <ResearchLinks links={requirements.sources} /> : <p>Not recorded</p>}</div>
        <p className={styles.hint}>Missing or unconfirmed information does not mean there are no requirements.</p>
      </>}
    </div>
  </section>;
}

type EditorProps = {
  requirements: EntryRequirements | null;
  sources: ResearchLink[];
  onSourcesChange: (sources: ResearchLink[]) => void;
  disabled: boolean;
};

export function EntryRequirementsEditor({ requirements, sources, onSourcesChange, disabled }: EditorProps) {
  return <fieldset className={styles.editor + " wide"} disabled={disabled}>
    <legend>Entry requirements research</legend>
    <p className={styles.reminder}>{reminder}</p>
    <p className={styles.hint}>All fields are optional. Record the traveler details this research applies to; leave unknown requirements blank.</p>
    <div className="form-grid">
      {ENTRY_REQUIREMENT_FIELDS.map((field, index) => <label className={index < 2 ? "field" : "field wide"} key={field.name}>
        <span>{field.label}</span>
        {index < 2 ? <input name={field.name} defaultValue={requirements?.[field.name] ?? ""} maxLength={field.maxLength} placeholder={index === 0 ? "e.g. United States" : "e.g. Tourism"} /> :
          <textarea name={field.name} defaultValue={requirements?.[field.name] ?? ""} maxLength={field.maxLength} rows={3} placeholder="Not recorded" />}
        {field.name === "travelerCircumstances" && <small>For example, residency, dual nationality, or traveling with children. This notebook is shared; avoid passport numbers or other sensitive document details.</small>}
      </label>)}
      <label className="field"><span>Last checked date</span><input name="lastCheckedDate" type="date" min="0001-01-01" max="9999-12-31" defaultValue={requirements?.lastCheckedDate ?? ""} /><small>Enter the date you verified the information. Saving does not set it automatically.</small></label>
    </div>
    <p className={styles.sourceHint}>Add official government or embassy source links and describe what each source covers.</p>
    <ResearchLinksEditor links={sources} onChange={onSourcesChange} disabled={disabled} />
  </fieldset>;
}
