"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { ResearchLinks, ResearchLinksEditor } from "@/components/research-links";
import { EMERGENCY_CONTACT_MAX_LENGTH, HEALTH_SAFETY_FIELDS, MAX_EMERGENCY_CONTACTS, type EmergencyContact, type HealthSafety } from "@/lib/health-safety";
import { formatCalendarDate } from "@/lib/trip-dates";
import type { ResearchLink } from "@/lib/types";
import { randomUuid } from "@/lib/uuid";
import styles from "./health-safety.module.css";

const reminder = "Manually maintained research. Travel advisories, health guidance, and local conditions change. Verify with official government and health sources before travel.";
const missing = "Missing or unconfirmed information does not mean the destination is safe or that no precautions are needed.";
// The level and last checked date share the first row; the longer research follows.
const [levelField, ...researchFields] = HEALTH_SAFETY_FIELDS;
const fieldHints = {
  advisoryWarnings: "Warnings from government travel advisories, and which government issued each.",
  healthPrecautions: "Recommended vaccinations, medical precautions, and other health considerations.",
  localSafety: "Safety concerns, common scams, areas to avoid, and general safety guidance.",
} as const;

type PanelProps = {
  healthSafety: HealthSafety | null;
  disabled: boolean;
  onEdit: () => void;
  onClear: () => void;
};

export function HealthSafetyPanel({ healthSafety, disabled, onEdit, onClear }: PanelProps) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  return <section className={styles.panel} aria-label="Health and safety">
    <div className="section-heading">
      <h4><button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded((open) => !open)}>Health and safety<ChevronDown size={18} aria-hidden="true" /></button></h4>
      <div className={styles.actions}>
        <button type="button" className="button secondary small" disabled={disabled} onClick={onEdit}>
          {healthSafety ? <Pencil size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
          {healthSafety ? "Edit health and safety" : "Add health and safety"}
        </button>
        {healthSafety && <button type="button" className="text-button" disabled={disabled} onClick={onClear}><Trash2 size={14} aria-hidden="true" />Clear</button>}
      </div>
    </div>
    <div id={contentId} className={styles.content} hidden={!expanded}>
      <p className={styles.reminder}>{reminder}</p>
      {!healthSafety ? <p className={styles.empty}>No health and safety information recorded. {missing}</p> : <>
        <dl className={styles.details}>
          <div><dt>{levelField.label}</dt><dd>{healthSafety[levelField.name] || "Not recorded"}</dd></div>
          <div><dt>Last checked</dt><dd>{healthSafety.lastCheckedDate ? formatCalendarDate(healthSafety.lastCheckedDate) : "Not checked / unconfirmed"}</dd></div>
          {researchFields.map((field) => <div key={field.name}><dt>{field.label}</dt><dd>{healthSafety[field.name] || "Not recorded"}</dd></div>)}
        </dl>
        <div className={styles.list}><h5>Emergency contacts</h5>{healthSafety.emergencyContacts.length ? <ul className={styles.contacts}>
          {healthSafety.emergencyContacts.map((contact) => <li key={contact.id}><strong>{contact.name}</strong><span>{contact.phone}</span>{contact.notes && <span className={styles.contactNotes}>{contact.notes}</span>}</li>)}
        </ul> : <p>Not recorded</p>}</div>
        <div className={styles.list}><h5>Sources</h5>{healthSafety.sources.length ? <ResearchLinks links={healthSafety.sources} /> : <p>Not recorded</p>}</div>
        <p className={styles.hint}>{missing}</p>
      </>}
    </div>
  </section>;
}

type EditorProps = {
  healthSafety: HealthSafety | null;
  contacts: EmergencyContact[];
  onContactsChange: (contacts: EmergencyContact[]) => void;
  sources: ResearchLink[];
  onSourcesChange: (sources: ResearchLink[]) => void;
  disabled: boolean;
};

export function HealthSafetyEditor({ healthSafety, contacts, onContactsChange, sources, onSourcesChange, disabled }: EditorProps) {
  return <fieldset className={styles.editor + " wide"} disabled={disabled}>
    <legend>Health and safety research</legend>
    <p className={styles.reminder}>{reminder}</p>
    <p className={styles.hint}>All fields are optional. Leave anything you have not researched blank.</p>
    <div className="form-grid">
      <label className="field"><span>{levelField.label}</span><input name={levelField.name} defaultValue={healthSafety?.[levelField.name] ?? ""} maxLength={levelField.maxLength} autoFocus placeholder="e.g. Level 2: Exercise increased caution" /></label>
      <label className="field"><span>Last checked date</span><input name="lastCheckedDate" type="date" min="0001-01-01" max="9999-12-31" defaultValue={healthSafety?.lastCheckedDate ?? ""} /><small>Enter the date you verified the information. Saving does not set it automatically.</small></label>
      {researchFields.map((field) => <label className="field wide" key={field.name}>
        <span>{field.label}</span>
        <textarea name={field.name} defaultValue={healthSafety?.[field.name] ?? ""} maxLength={field.maxLength} rows={3} placeholder="Not recorded" />
        <small>{fieldHints[field.name]}</small>
      </label>)}
    </div>
    <EmergencyContactsEditor contacts={contacts} onChange={onContactsChange} disabled={disabled} />
    <p className={styles.sourceHint}>Add official government, embassy, or health agency source links and describe what each source covers.</p>
    <ResearchLinksEditor links={sources} onChange={onSourcesChange} disabled={disabled} />
  </fieldset>;
}

function EmergencyContactsEditor({ contacts, onChange, disabled }: { contacts: EmergencyContact[]; onChange: (contacts: EmergencyContact[]) => void; disabled: boolean }) {
  const id = useId();
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<string | null>(null);

  // A new contact's name, or after a removal the next contact's name or Add contact, takes focus.
  useEffect(() => {
    if (pendingFocus.current === null) return;
    if (pendingFocus.current === "add") addButton.current?.focus();
    else nameInputs.current.get(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  }, [contacts]);

  function update(contactId: string, field: "name" | "phone" | "notes", value: string) {
    onChange(contacts.map((contact) => contact.id === contactId ? { ...contact, [field]: value } : contact));
  }

  function add() {
    if (disabled || contacts.length >= MAX_EMERGENCY_CONTACTS) return;
    const contactId = randomUuid();
    pendingFocus.current = contactId;
    onChange([...contacts, { id: contactId, name: "", phone: "", notes: "" }]);
  }

  function remove(index: number) {
    if (disabled) return;
    pendingFocus.current = contacts[index + 1]?.id ?? contacts[index - 1]?.id ?? "add";
    onChange(contacts.filter((_, position) => position !== index));
  }

  return <fieldset className={styles.contactsEditor} disabled={disabled} aria-describedby={`${id}-hint`}>
    <legend>Emergency contacts</legend>
    <p className={styles.hint} id={`${id}-hint`}>Add local emergency numbers, an embassy or consulate, travel insurance assistance, or anyone else to call. Each contact needs a name and phone number.</p>
    {contacts.length > 0 && <div className={styles.contactRows}>
      {contacts.map((contact, index) => <div className={styles.contactRow} key={contact.id}>
        <div className={styles.rowHeading}>
          <span>Contact {index + 1}</span>
          <button type="button" className={styles.remove} disabled={disabled} onClick={() => remove(index)} aria-label={`Remove contact ${index + 1}`}>
            <Trash2 size={14} aria-hidden="true" />Remove
          </button>
        </div>
        <label className="field"><span>Name</span>
          <input ref={(input) => { if (input) nameInputs.current.set(contact.id, input); else nameInputs.current.delete(contact.id); }}
            value={contact.name} onChange={(event) => update(contact.id, "name", event.target.value)} required maxLength={EMERGENCY_CONTACT_MAX_LENGTH.name}
            placeholder="e.g. Embassy or consulate" aria-label={`Contact ${index + 1} name`} />
        </label>
        <label className="field"><span>Phone number</span>
          <input type="tel" value={contact.phone} onChange={(event) => update(contact.id, "phone", event.target.value)} required maxLength={EMERGENCY_CONTACT_MAX_LENGTH.phone}
            placeholder="e.g. +1 202 555 0100" autoComplete="off" aria-label={`Contact ${index + 1} phone number`} />
        </label>
        <label className="field wide"><span>Notes <span className={styles.optional}>(optional)</span></span>
          <input value={contact.notes} onChange={(event) => update(contact.id, "notes", event.target.value)} maxLength={EMERGENCY_CONTACT_MAX_LENGTH.notes}
            placeholder="e.g. Hours, languages, or when to call" aria-label={`Contact ${index + 1} notes`} />
        </label>
      </div>)}
    </div>}
    <button type="button" ref={addButton} className="button secondary small" disabled={disabled || contacts.length >= MAX_EMERGENCY_CONTACTS} onClick={add}>
      <Plus size={15} aria-hidden="true" />Add contact
    </button>
    {contacts.length >= MAX_EMERGENCY_CONTACTS && <p className={styles.hint}>You can save up to {MAX_EMERGENCY_CONTACTS} emergency contacts.</p>}
  </fieldset>;
}
