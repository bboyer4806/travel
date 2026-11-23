"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ExternalLink, MapPin, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { useFocusFallback } from "@/components/focus-after";
import { ResearchLinks, ResearchLinksEditor } from "@/components/research-links";
import { formatCoordinates } from "@/lib/coordinates";
import {
  CHECK_LABELS, EMERGENCY_CONTACT_MAX_LENGTH, HEALTH_SAFETY_FIELDS, MAX_EMERGENCY_CONTACTS, MEDICAL_PROVIDER_MAX_LENGTH, PROVIDER_CHECKS, SHORT_NOTICE_CARE, SHORT_NOTICE_LABELS, US_ADVISORY_LEVELS,
  mapHref, newProviderDraft, providersInOrder, telephoneHref, usAdvisoryLabel, type EmergencyContact, type HealthSafety, type MedicalProvider, type MedicalProviderDraft, type ProviderCheck, type ShortNoticeCare,
} from "@/lib/health-safety";
import { formatCalendarDate } from "@/lib/trip-dates";
import type { ResearchLink } from "@/lib/types";
import { randomUuid } from "@/lib/uuid";
import styles from "./health-safety.module.css";

const reminder = "Manually maintained research. Travel advisories, health guidance, and local conditions change. Verify with official government and health sources before travel.";
const missing = "Missing or unconfirmed information does not mean the destination is safe or that no precautions are needed.";
// The U.S. travel advisory level comes first (TRA-171). The advisory level as typed and the last checked date share the
// next row, and the longer research follows.
const usAdvisoryField = "U.S. travel advisory level";
const [levelField, ...researchFields] = HEALTH_SAFETY_FIELDS;
const fieldHints = {
  advisoryWarnings: "Warnings from government travel advisories, and which government issued each.",
  healthPrecautions: "Recommended vaccinations, medical precautions, and other health considerations.",
  localSafety: "Safety concerns, common scams, areas to avoid, and general safety guidance.",
} as const;
// Non-emergency medical care (TRA-172): doctors and clinics, apart from the emergency contacts, which it follows.
const careNote = "For routine illness or minor injuries, not emergencies. In an emergency, call local emergency services or the emergency contacts above.";
const careHint = "Providers verified to offer consultations in English are listed first. Verified means a source confirmed it when the provider was last verified; call ahead, since no appointment or availability is guaranteed. Appearing on a U.S. embassy or consulate list of medical providers does not mean the U.S. government endorses or guarantees a provider.";
const providersHint = "Add doctors, medical clinics, or outpatient facilities for routine illness or minor injuries, not emergency services. Prefer providers confirmed to offer consultations in English, starting with the U.S. embassy or consulate's list of medical providers, then the provider's own website and other reliable sources. Leave anything you have not verified Unconfirmed or blank. Appearing on an embassy list does not mean the U.S. government endorses a provider.";
/** A provider's soonest visit as its section shows it: what a source confirmed, never a guarantee, or Unconfirmed. */
const shortNoticeText = (value: ShortNoticeCare) => value === "unconfirmed" ? SHORT_NOTICE_LABELS.unconfirmed : `${SHORT_NOTICE_LABELS[value]} (verified, not guaranteed)`;

type PanelProps = {
  healthSafety: HealthSafety | null;
  disabled: boolean;
  onEdit: () => void;
  onClear: () => void;
};

export function HealthSafetyPanel({ healthSafety, disabled, onEdit, onClear }: PanelProps) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const keepFocus = useFocusFallback(toggle);
  return <section className={styles.panel} aria-label="Health and safety">
    <div className="section-heading">
      <h4><button ref={toggle} type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded((open) => !open)}>Health and safety<ChevronDown size={18} aria-hidden="true" /></button></h4>
      {/* Edit and Clear show only while the section is open, and Add whenever nothing is recorded (TRA-148). */}
      {(expanded || !healthSafety) && <div ref={keepFocus} className={styles.actions}>
        <button type="button" className="button secondary small" disabled={disabled} onClick={onEdit}>
          {healthSafety ? <Pencil size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
          {healthSafety ? "Edit health and safety" : "Add health and safety"}
        </button>
        {healthSafety && <button type="button" className="text-button" disabled={disabled} onClick={onClear}><Trash2 size={14} aria-hidden="true" />Clear</button>}
      </div>}
    </div>
    <div id={contentId} className={styles.content} hidden={!expanded}>
      <p className={styles.reminder}>{reminder}</p>
      {!healthSafety ? <p className={styles.empty}>No health and safety information recorded. {missing}</p> : <>
        <dl className={styles.details}>
          {/* Its color always comes with its number and description, so the level never depends on color alone. */}
          <div className={styles.usAdvisory}><dt>{usAdvisoryField}</dt><dd>{healthSafety.usAdvisoryLevel === null ? "Not recorded"
            : <span className={styles.advisoryLevel + " " + styles[`level${healthSafety.usAdvisoryLevel}`]}>{usAdvisoryLabel(healthSafety.usAdvisoryLevel)}</span>}</dd></div>
          <div><dt>{levelField.label}</dt><dd>{healthSafety[levelField.name] || "Not recorded"}</dd></div>
          <div><dt>Last checked</dt><dd>{healthSafety.lastCheckedDate ? formatCalendarDate(healthSafety.lastCheckedDate) : "Not checked / unconfirmed"}</dd></div>
          {researchFields.map((field) => <div key={field.name}><dt>{field.label}</dt><dd>{healthSafety[field.name] || "Not recorded"}</dd></div>)}
        </dl>
        <div className={styles.list}><h5>Emergency contacts</h5>{healthSafety.emergencyContacts.length ? <ul className={styles.contacts}>
          {healthSafety.emergencyContacts.map((contact) => <li key={contact.id}><strong>{contact.name}</strong><span>{contact.phone}</span>{contact.notes && <span className={styles.contactNotes}>{contact.notes}</span>}</li>)}
        </ul> : <p>Not recorded</p>}</div>
        <MedicalCare providers={healthSafety.medicalProviders} />
        <div className={styles.list}><h5>Sources</h5>{healthSafety.sources.length ? <ResearchLinks links={healthSafety.sources} /> : <p>Not recorded</p>}</div>
        <p className={styles.hint}>{missing}</p>
      </>}
    </div>
  </section>;
}

/** Non-emergency medical care (TRA-172): the doctors and clinics recorded, those verified to offer consultations in English first. */
function MedicalCare({ providers }: { providers: MedicalProvider[] }) {
  return <div className={styles.list}>
    <h5>Non-emergency medical care</h5>
    <p className={styles.careNote}>{careNote}</p>
    {providers.length ? <ul className={styles.providers}>
      {providersInOrder(providers).map((provider) => <li className={styles.provider} key={provider.id}><MedicalProviderDetails provider={provider} /></li>)}
    </ul> : <p>Not recorded</p>}
    <p className={styles.hint}>{careHint}</p>
  </div>;
}

/** One provider: what it offers, what a source confirmed, and links that call it, open its website and show it on a map. */
function MedicalProviderDetails({ provider }: { provider: MedicalProvider }) {
  const { name, services, phone, website, address, coordinates, notes, sources, lastVerifiedDate } = provider;
  const newTab = <span className="sr-only"> (opens in a new tab)</span>;
  return <>
    <h6 className={styles.providerName}>{name}</h6>
    {services && <p className={styles.services}>{services}</p>}
    <dl className={styles.providerDetails}>
      <div><dt>Consultations in English</dt><dd>{CHECK_LABELS[provider.englishConsultations]}</dd></div>
      <div><dt>Sees visiting American patients</dt><dd>{CHECK_LABELS[provider.visitingAmericans]}</dd></div>
      <div><dt>Walk-in, same-day or short-notice visits</dt><dd>{shortNoticeText(provider.shortNotice)}</dd></div>
      <div><dt>Last verified</dt><dd>{lastVerifiedDate ? formatCalendarDate(lastVerifiedDate) : "Not verified"}</dd></div>
      <div><dt>Phone</dt><dd>{phone ? <a className={styles.contactLink} href={telephoneHref(phone)}><Phone size={14} aria-hidden="true" /><span>{phone}<span className="sr-only">, call {name}</span></span></a> : "Not recorded"}</dd></div>
      <div><dt>Website</dt><dd>{website ? <a className={styles.contactLink} href={website} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" /><span>{new URL(website).hostname.replace(/^www\./, "")}{newTab}</span></a> : "Not recorded"}</dd></div>
      <div className={styles.wide}><dt>Address and map location</dt><dd>{address || coordinates ? <>
        {address && <a className={styles.contactLink} href={mapHref(address)} target="_blank" rel="noopener noreferrer"><MapPin size={14} aria-hidden="true" /><span>{address}<span className="sr-only"> in Google Maps</span>{newTab}</span></a>}
        {coordinates && <a className={styles.contactLink} href={mapHref(`${coordinates.latitude},${coordinates.longitude}`)} target="_blank" rel="noopener noreferrer"><MapPin size={14} aria-hidden="true" /><span>{formatCoordinates(coordinates)}<span className="sr-only"> in Google Maps</span>{newTab}</span></a>}
      </> : "Not recorded"}</dd></div>
      {notes && <div className={styles.wide}><dt>Notes</dt><dd>{notes}</dd></div>}
      <div className={styles.wide}><dt>Sources</dt><dd>{sources.length ? <ResearchLinks links={sources} /> : "Not recorded"}</dd></div>
    </dl>
  </>;
}

type EditorProps = {
  healthSafety: HealthSafety | null;
  contacts: EmergencyContact[];
  onContactsChange: (contacts: EmergencyContact[]) => void;
  providers: MedicalProviderDraft[];
  onProvidersChange: (providers: MedicalProviderDraft[]) => void;
  sources: ResearchLink[];
  onSourcesChange: (sources: ResearchLink[]) => void;
  disabled: boolean;
};

export function HealthSafetyEditor({ healthSafety, contacts, onContactsChange, providers, onProvidersChange, sources, onSourcesChange, disabled }: EditorProps) {
  return <fieldset className={styles.editor + " wide"} disabled={disabled}>
    <legend>Health and safety research</legend>
    <p className={styles.reminder}>{reminder}</p>
    <p className={styles.hint}>All fields are optional. Leave anything you have not researched blank.</p>
    <div className="form-grid">
      <label className="field wide"><span>{usAdvisoryField}</span>
        <select name="usAdvisoryLevel" defaultValue={healthSafety?.usAdvisoryLevel ?? ""}>
          <option value="">Not set</option>
          {US_ADVISORY_LEVELS.map((level) => <option key={level} value={level}>{usAdvisoryLabel(level)}</option>)}
        </select>
        <small>The U.S. State Department&apos;s level for this destination. Leave it Not set until you have checked the current advisory.</small>
      </label>
      <label className="field"><span>{levelField.label}</span><input name={levelField.name} defaultValue={healthSafety?.[levelField.name] ?? ""} maxLength={levelField.maxLength} placeholder="e.g. Level 2: Exercise increased caution" /></label>
      <label className="field"><span>Last checked date</span><input name="lastCheckedDate" type="date" min="0001-01-01" max="9999-12-31" defaultValue={healthSafety?.lastCheckedDate ?? ""} /><small>Enter the date you verified the information. Saving does not set it automatically.</small></label>
      {researchFields.map((field) => <label className="field wide" key={field.name}>
        <span>{field.label}</span>
        <textarea name={field.name} defaultValue={healthSafety?.[field.name] ?? ""} maxLength={field.maxLength} rows={3} placeholder="Not recorded" />
        <small>{fieldHints[field.name]}</small>
      </label>)}
    </div>
    <EmergencyContactsEditor contacts={contacts} onChange={onContactsChange} disabled={disabled} />
    <MedicalProvidersEditor providers={providers} onChange={onProvidersChange} disabled={disabled} />
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

/**
 * Doctors and clinics for non-emergency care (TRA-172), as many as are worth keeping. Each needs a name; everything else is
 * optional, and what a source confirmed starts Unconfirmed. A new provider's name, or after a removal the next provider's
 * name or Add provider, takes focus.
 */
function MedicalProvidersEditor({ providers, onChange, disabled }: { providers: MedicalProviderDraft[]; onChange: (providers: MedicalProviderDraft[]) => void; disabled: boolean }) {
  const id = useId();
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    if (pendingFocus.current === null) return;
    if (pendingFocus.current === "add") addButton.current?.focus();
    else nameInputs.current.get(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  }, [providers]);

  function update<K extends keyof MedicalProviderDraft>(providerId: string, field: K, value: MedicalProviderDraft[K]) {
    onChange(providers.map((provider) => provider.id === providerId ? { ...provider, [field]: value } : provider));
  }

  function add() {
    if (disabled) return;
    const providerId = randomUuid();
    pendingFocus.current = providerId;
    onChange([...providers, newProviderDraft(providerId)]);
  }

  function remove(index: number) {
    if (disabled) return;
    pendingFocus.current = providers[index + 1]?.id ?? providers[index - 1]?.id ?? "add";
    onChange(providers.filter((_, position) => position !== index));
  }

  const optional = <span className={styles.optional}>(optional)</span>;
  return <fieldset className={styles.contactsEditor} disabled={disabled} aria-describedby={`${id}-providers-hint`}>
    <legend>Non-emergency medical care</legend>
    <p className={styles.hint} id={`${id}-providers-hint`}>{providersHint}</p>
    {providers.length > 0 && <div className={styles.contactRows}>
      {providers.map((provider, index) => {
        const label = `Provider ${index + 1}`;
        // A latitude or longitude needs the other, as a place's coordinates do.
        const located = provider.latitude.trim() !== "" || provider.longitude.trim() !== "";
        /** A text field's value, its limit, its name for screen readers and its change. */
        const text = (field: keyof typeof fieldNames) => ({
          value: provider[field], maxLength: MEDICAL_PROVIDER_MAX_LENGTH[field], "aria-label": `${label} ${fieldNames[field]}`,
          onChange: (event: { target: { value: string } }) => update(provider.id, field, event.target.value),
        });
        return <div className={styles.contactRow} key={provider.id} role="group" aria-labelledby={`${id}-${provider.id}`}>
          <div className={styles.rowHeading}>
            <span id={`${id}-${provider.id}`}>{label}</span>
            <button type="button" className={styles.remove} disabled={disabled} onClick={() => remove(index)} aria-label={`Remove provider ${index + 1}`}>
              <Trash2 size={14} aria-hidden="true" />Remove
            </button>
          </div>
          <label className="field wide"><span>Name</span>
            <input ref={(input) => { if (input) nameInputs.current.set(provider.id, input); else nameInputs.current.delete(provider.id); }} {...text("name")} required placeholder="e.g. International medical clinic, or a doctor's name" />
          </label>
          <label className="field wide"><span>Medical specialty or services {optional}</span><input {...text("services")} placeholder="e.g. General practice, pediatrics" /></label>
          <label className="field"><span>Phone number {optional}</span><input type="tel" {...text("phone")} placeholder="e.g. +351 21 000 0000" autoComplete="off" /></label>
          <label className="field"><span>Website {optional}</span>
            <input type="url" inputMode="url" pattern="https?://.+" title="Enter a full website address beginning with https:// or http://." {...text("website")} placeholder="https://" autoComplete="off" autoCapitalize="none" spellCheck={false} />
          </label>
          <label className="field wide"><span>Address {optional}</span><input {...text("address")} placeholder="Street address, city" /></label>
          <label className="field"><span>Latitude {optional}</span>
            <input type="number" className="no-spin-buttons" min="-90" max="90" step="any" required={located} value={provider.latitude} onChange={(event) => update(provider.id, "latitude", event.target.value)} aria-label={`${label} latitude`} />
            <small>Its map location, with the longitude: from −90 to 90, negative south of the equator.</small>
          </label>
          <label className="field"><span>Longitude {optional}</span>
            <input type="number" className="no-spin-buttons" min="-180" max="180" step="any" required={located} value={provider.longitude} onChange={(event) => update(provider.id, "longitude", event.target.value)} aria-label={`${label} longitude`} />
            <small>From −180 to 180, negative west of Greenwich.</small>
          </label>
          <label className="field"><span>Consultations in English</span>
            <select value={provider.englishConsultations} onChange={(event) => update(provider.id, "englishConsultations", event.target.value as ProviderCheck)} aria-label={`${label} consultations in English`}>
              {PROVIDER_CHECKS.map((check) => <option key={check} value={check}>{CHECK_LABELS[check]}</option>)}
            </select>
          </label>
          <label className="field"><span>Sees visiting American patients</span>
            <select value={provider.visitingAmericans} onChange={(event) => update(provider.id, "visitingAmericans", event.target.value as ProviderCheck)} aria-label={`${label} sees visiting American patients`}>
              {PROVIDER_CHECKS.map((check) => <option key={check} value={check}>{CHECK_LABELS[check]}</option>)}
            </select>
          </label>
          <label className="field"><span>Walk-in, same-day or short-notice visits</span>
            <select value={provider.shortNotice} onChange={(event) => update(provider.id, "shortNotice", event.target.value as ShortNoticeCare)} aria-label={`${label} walk-in, same-day or short-notice visits`}>
              {SHORT_NOTICE_CARE.map((value) => <option key={value} value={value}>{SHORT_NOTICE_LABELS[value]}</option>)}
            </select>
            <small>Choose a visit only when a source confirms it. It is never a guarantee.</small>
          </label>
          <label className="field"><span>Last verified date {optional}</span>
            <input type="date" min="0001-01-01" max="9999-12-31" value={provider.lastVerifiedDate ?? ""} onChange={(event) => update(provider.id, "lastVerifiedDate", event.target.value || null)} aria-label={`${label} last verified date`} />
            <small>The date you checked its details. Saving does not set it.</small>
          </label>
          <label className="field wide"><span>Notes {optional}</span><textarea {...text("notes")} rows={2} placeholder="e.g. Hours, how to book, or payment" /></label>
          <ResearchLinksEditor links={provider.sources} onChange={(sources) => update(provider.id, "sources", sources)} disabled={disabled} noun="source"
            legend="Sources" hint="Links supporting this provider's details, such as the embassy's list or its own website." />
        </div>;
      })}
    </div>}
    <button type="button" ref={addButton} className="button secondary small" disabled={disabled} onClick={add}>
      <Plus size={15} aria-hidden="true" />Add provider
    </button>
  </fieldset>;
}

/** Each provider text field's name, after its provider's, for screen readers. */
const fieldNames = { name: "name", services: "medical specialty or services", phone: "phone number", website: "website", address: "address", notes: "notes" } as const;
