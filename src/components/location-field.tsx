"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { MapPin } from "lucide-react";
import type { LocationSuggestion } from "@/lib/location-search";

type SearchResult = { query: string; locations: LocationSuggestion[]; failed?: boolean };

type Props = {
  name: string;
  label: string;
  defaultValue?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  helpText?: string;
};

export default function LocationField({ name, label, defaultValue = "", hint, disabled, required, autoFocus, placeholder = "Start typing a city, e.g. Wooster, OH", helpText = "Choose a suggestion or keep your own city or airport." }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState(-1);
  const [result, setResult] = useState<SearchResult | null>(null);
  const query = value.trim();
  const searching = open && !disabled && !composing && query.length >= 2;
  const current = result?.query === query ? result : null;
  const locations = searching && current ? current.locations : [];
  const expanded = locations.length > 0;
  const status = !searching ? "" : !current ? "Finding cities…" : current.failed
    ? "City suggestions are unavailable. You can still enter your own location."
    : !locations.length ? "No matching cities. Try adding a state or country, or keep your own text."
    : `${locations.length} ${locations.length === 1 ? "city suggestion" : "city suggestions"}. Use the arrow keys to choose, then press Enter.`;

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const debounce = setTimeout(async () => {
      timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`/api/locations?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Location lookup failed");
        const body = await response.json();
        if (!Array.isArray(body.locations)) throw new Error("Invalid location response");
        if (!cancelled) { setResult({ query, locations: body.locations }); setActive(-1); }
      } catch {
        if (!cancelled) setResult({ query, locations: [], failed: true });
      } finally {
        clearTimeout(timeout);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, searching]);

  useEffect(() => {
    if (active >= 0) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(location: LocationSuggestion) {
    input.current?.focus();
    setValue(location.label);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || composing) return;
    if (event.key === "Escape" && searching) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (locations.length) setActive(event.key === "ArrowDown"
        ? (active + 1) % locations.length
        : active <= 0 ? locations.length - 1 : active - 1);
    } else if (event.key === "Enter" && expanded && locations[active]) {
      event.preventDefault();
      choose(locations[active]);
    } else if (event.key === "Tab") {
      setOpen(false);
      setActive(-1);
    }
  }

  return <div className="field wide location-field" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); }
  }}>
    <label htmlFor={id}>{label}</label>
    <div className="location-input">
    <input ref={input} id={id} name={name} value={value} disabled={disabled} required={required} autoFocus={autoFocus} maxLength={120}
      placeholder={placeholder} autoComplete="off" spellCheck={false}
      role="combobox" aria-autocomplete="list" aria-expanded={expanded}
      aria-controls={expanded ? `${id}-suggestions` : undefined}
      aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
      aria-describedby={`${id}-help${hint ? ` ${id}-hint` : ""}`}
      onFocus={() => { setOpen(true); setActive(-1); }}
      onChange={(event) => { setValue(event.target.value); setOpen(true); setActive(-1); }}
      onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
      onKeyDown={onKeyDown} />
    {searching && <div className="location-panel">
      {expanded && <ul ref={list} id={`${id}-suggestions`} className="location-suggestions" role="listbox" aria-label="City suggestions">
        {locations.map((location, index) => <li key={location.id} role="presentation">
          <button type="button" id={`${id}-option-${index}`} role="option" aria-selected={active === index}
            tabIndex={-1} className="location-option" onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(location)}>
            <MapPin size={17} aria-hidden="true" /><span><strong>{location.name}</strong><small>{[location.region, location.country].filter(Boolean).join(", ")}</small></span>
          </button>
        </li>)}
      </ul>}
      {!expanded && <p className="location-message" aria-hidden="true">{status}</p>}
    </div>}
    </div>
    <span className="sr-only" role="status" aria-live="polite">{status}</span>
    <small id={`${id}-help`}>{helpText}</small>
    <p className="location-credit">Locations by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> / <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a></p>
    {hint && <small id={`${id}-hint`}>{hint}</small>}
  </div>;
}
