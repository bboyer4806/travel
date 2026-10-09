"use client";

import { useEffect, useId, useRef } from "react";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import type { ResearchLink } from "@/lib/types";
import styles from "./research-links.module.css";

const MAX_LINKS = 20;

type EditorProps = {
  links: ResearchLink[];
  onChange: (links: ResearchLink[]) => void;
  disabled?: boolean;
};

export function ResearchLinksEditor({ links, onChange, disabled = false }: EditorProps) {
  const id = useId();
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    if (pendingFocus.current === null) return;
    if (pendingFocus.current === "add") addButton.current?.focus();
    else inputs.current.get(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  }, [links]);

  function update(linkId: string, field: "url" | "description", value: string) {
    onChange(links.map((link) => link.id === linkId ? { ...link, [field]: value } : link));
  }

  function add() {
    if (disabled || links.length >= MAX_LINKS) return;
    const linkId = crypto.randomUUID();
    pendingFocus.current = linkId;
    onChange([...links, { id: linkId, url: "", description: "" }]);
  }

  function remove(index: number) {
    if (disabled) return;
    pendingFocus.current = links[index + 1]?.id ?? links[index - 1]?.id ?? "add";
    onChange(links.filter((_, position) => position !== index));
  }

  return <fieldset className={styles.editor} disabled={disabled} aria-describedby={`${id}-hint`}>
    <legend>Website and research links</legend>
    <p className={styles.hint} id={`${id}-hint`}>Save booking pages, guides, or other useful references with a short description.</p>
    {links.length > 0 && <div className={styles.rows}>
      {links.map((link, index) => <div className={styles.row} key={link.id}>
        <div className={styles.rowHeading}>
          <span>Link {index + 1}</span>
          <button type="button" className={styles.remove} disabled={disabled} onClick={() => remove(index)} aria-label={`Remove link ${index + 1}`}>
            <Trash2 size={14} aria-hidden="true" />Remove
          </button>
        </div>
        <label className={styles.field} htmlFor={`${id}-${link.id}-url`}>
          <span>Website URL</span>
          <input id={`${id}-${link.id}-url`} ref={(input) => { if (input) inputs.current.set(link.id, input); else inputs.current.delete(link.id); }}
            type="url" inputMode="url" required maxLength={2048} pattern="https?://.+" title="Enter a full website address beginning with https:// or http://."
            value={link.url} onChange={(event) => update(link.id, "url", event.target.value)} placeholder="https://" autoComplete="off" autoCapitalize="none" spellCheck={false}
            aria-label={`Link ${index + 1} website URL`} />
        </label>
        <label className={styles.field} htmlFor={`${id}-${link.id}-description`}>
          <span>Short description <span className={styles.optional}>(optional)</span></span>
          <input id={`${id}-${link.id}-description`} value={link.description} onChange={(event) => update(link.id, "description", event.target.value)}
            maxLength={160} placeholder="e.g. Booking options or a helpful guide" aria-label={`Link ${index + 1} short description`} />
        </label>
      </div>)}
    </div>}
    <button type="button" ref={addButton} className="button secondary small" disabled={disabled || links.length >= MAX_LINKS} onClick={add}>
      <Plus size={15} aria-hidden="true" />Add link
    </button>
    {links.length >= MAX_LINKS && <p className={styles.hint}>You can save up to {MAX_LINKS} links.</p>}
  </fieldset>;
}

export function ResearchLinks({ links }: { links: ResearchLink[] }) {
  const safeLinks = links.flatMap((link) => {
    try {
      const url = new URL(link.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") return [];
      return [{ ...link, hostname: url.hostname.replace(/^www\./, "") }];
    } catch {
      return [];
    }
  });
  if (safeLinks.length === 0) return null;

  return <ul className={styles.links} aria-label="Website and research links">
    {safeLinks.map((link) => <li key={link.id}>
      <a href={link.url} target="_blank" rel="noreferrer" className={styles.link} title="Opens in a new tab">
        <span>{link.description.trim() || link.hostname}</span><ExternalLink size={13} aria-hidden="true" />
      </a>
      {link.description.trim() && <span className={styles.hostname}>{link.hostname}</span>}
    </li>)}
  </ul>;
}
