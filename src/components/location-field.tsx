"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { MapPin, Plane } from "lucide-react";
import { formatDestinationLabel, formatSavedDestinationLabel } from "@/lib/destination-label";
import { searchLibrary } from "@/lib/destination-library";
import { dropdownPosition } from "@/lib/dropdown-position";
import type { LocationSuggestion } from "@/lib/location-search";
import type { LibraryDestination } from "@/lib/types";

type SearchResult = { query: string; locations: LocationSuggestion[]; failed?: boolean };
/** One entry in the list: a saved destination (TRA-142) or a city suggestion. */
type Option = { saved: LibraryDestination } | { location: LocationSuggestion };

/** An entry's name and where it is, as its two lines show them. A saved destination's city shows as saved, split at its first comma. */
function optionLines(option: Option): [string, string] {
  if ("location" in option) return [option.location.name, [option.location.region, option.location.country].filter(Boolean).join(", ")];
  const [name, ...where] = formatSavedDestinationLabel(option.saved).split(",");
  return [name.trim(), where.join(",").trim()];
}

/** How tall the suggestions are at most: 220 pixels of them inside a 1-pixel border, as before TRA-140. */
const TALLEST = 222;

type Props = {
  name: string;
  label: string;
  defaultValue?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  compactDestination?: boolean;
  /**
   * Add destination's saved destinations (TRA-142). The list offers those matching what is typed first, marked In your
   * library, in place of the suggestions that are them. Choosing one sends its ID as `destinationId` instead of a city.
   */
  library?: readonly LibraryDestination[];
};

export default function LocationField({ name, label, defaultValue = "", hint, disabled, required, compactDestination = false, library, placeholder = "Start typing a city, e.g. Wooster, OH", helpText = "Choose a suggestion or keep your own city or airport." }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // A saved city opens exactly as saved, so editing it never starts from a shorter label (TRA-76).
  const [value, setValue] = useState(defaultValue);
  // What a destination's field chose, sent until the text changes: a city suggestion shows its shorter label while the
  // form sends its full label, recorded as a suggestion's, and a saved destination shows its city while the form sends
  // its ID (TRA-142). Any other text is sent exactly as entered.
  const [chosen, setChosen] = useState<{ display: string; full: string } | { display: string; destinationId: string } | null>(null);
  const choice = compactDestination && chosen?.display === value ? chosen : null;
  const suggestion = choice && "full" in choice ? choice : null;
  const saved = choice && "destinationId" in choice ? choice : null;
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState(-1);
  const [result, setResult] = useState<SearchResult | null>(null);
  const query = value.trim();
  const searching = open && !disabled && !composing && query.length >= 2;
  const current = result?.query === query ? result : null;
  // A destination is a city, so its field suggests no airports (TRA-132).
  const locations = searching && current ? current.locations.filter((location) => !(compactDestination && location.airport)) : [];
  // Saved destinations need no lookup, so they show while suggestions load, and when they can't (TRA-142).
  const found = searching && library ? searchLibrary(library, query, locations) : { destinations: [], suggestions: locations };
  const options: Option[] = [...found.destinations.map((destination) => ({ saved: destination })), ...found.suggestions.map((location) => ({ location }))];
  const expanded = options.length > 0;
  const status = !searching ? "" : expanded
    ? `${options.length} ${options.length === 1 ? "suggestion" : "suggestions"}${found.destinations.length ? `, ${found.destinations.length} in your library` : ""}. Use the arrow keys to choose, then press Enter.`
    : !current ? "Finding cities…" : current.failed
    ? "City suggestions are unavailable. You can still enter your own location."
    : "No matching cities. Try adding a state or country, or keep your own text.";

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

  // The suggestions float over the editor instead of inside its scrolling fields, which cut them off (TRA-140). They open
  // below the field, or above it when they don't fit below and there is more room above, and never past the part of the
  // window people can see, which an on-screen keyboard shortens. Scrolling anything that holds the field, such as the
  // editor's fields, closes them, as a select's list closes.
  useLayoutEffect(() => {
    if (!searching) return;
    const field = input.current!, box = panel.current!, viewport = window.visualViewport!;
    function place() {
      const rect = field.getBoundingClientRect();
      const { above, edge, maxHeight } = dropdownPosition(rect, { top: viewport.offsetTop, bottom: viewport.offsetTop + viewport.height }, TALLEST);
      Object.assign(box.style, { top: edge + "px", left: rect.left + "px", width: rect.width + "px", maxHeight: maxHeight + "px", transform: above ? "translateY(-100%)" : "" });
    }
    function scrolled({ target }: Event) {
      if (target instanceof Element && target !== field && target.contains(field)) { setOpen(false); setActive(-1); }
      else place();
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scrolled, true);
    viewport.addEventListener("resize", place);
    viewport.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", scrolled, true);
      viewport.removeEventListener("resize", place);
      viewport.removeEventListener("scroll", place);
    };
  }, [searching]);

  useEffect(() => {
    // Only the list scrolls to show the active suggestion, since scrolling anything that holds the field would close it.
    const shown = list.current, option = shown?.children[active];
    if (!shown || !option) return;
    const view = shown.getBoundingClientRect(), item = option.getBoundingClientRect();
    shown.scrollTop += Math.max(0, item.bottom - view.bottom) - Math.max(0, view.top - item.top);
  }, [active]);

  function choose(option: Option) {
    input.current?.focus();
    const next = "saved" in option
      ? { display: formatSavedDestinationLabel(option.saved), destinationId: option.saved.id }
      : { display: compactDestination ? formatDestinationLabel(option.location) : option.location.label, full: option.location.label };
    setChosen(next);
    setValue(next.display);
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
      if (options.length) setActive(event.key === "ArrowDown"
        ? (active + 1) % options.length
        : active <= 0 ? options.length - 1 : active - 1);
    } else if (event.key === "Enter" && expanded && options[active]) {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === "Tab") {
      setOpen(false);
      setActive(-1);
    }
  }

  return <div className="field wide location-field" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); }
  }}>
    <label htmlFor={id}>{label}</label>
    {compactDestination && !saved && <input type="hidden" name={name} value={suggestion?.full ?? value} disabled={disabled} />}
    {suggestion && <input type="hidden" name={name + "FromSuggestion"} value="true" disabled={disabled} />}
    {saved && <input type="hidden" name="destinationId" value={saved.destinationId} disabled={disabled} />}
    <input ref={input} id={id} name={compactDestination ? undefined : name} value={value} disabled={disabled} required={required} maxLength={120}
      placeholder={placeholder} autoComplete="off" spellCheck={false}
      role="combobox" aria-autocomplete="list" aria-expanded={expanded}
      aria-controls={expanded ? `${id}-suggestions` : undefined}
      aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
      aria-describedby={`${id}-help${hint ? ` ${id}-hint` : ""}`}
      onChange={(event) => { setValue(event.target.value); setOpen(true); setActive(-1); }}
      onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
      onKeyDown={onKeyDown} />
    {searching && <div ref={panel} className="location-panel">
      {expanded && <ul ref={list} id={`${id}-suggestions`} className="location-suggestions" role="listbox" aria-label={compactDestination ? "City suggestions" : "City and airport suggestions"}>
        {options.map((option, index) => {
          const [place, where] = optionLines(option);
          return <li key={"saved" in option ? "saved-" + option.saved.id : option.location.id} role="presentation">
            <button type="button" id={`${id}-option-${index}`} role="option" aria-selected={active === index}
              tabIndex={-1} className="location-option" onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}>
              {"location" in option && option.location.airport ? <Plane size={17} aria-hidden="true" /> : <MapPin size={17} aria-hidden="true" />}<span><strong>{place}</strong><small>{where}</small></span>
              {"saved" in option && <span className="library-tag">In your library</span>}
            </button>
          </li>;
        })}
      </ul>}
      {!expanded && <p className="location-message" aria-hidden="true">{status}</p>}
    </div>}
    <span className="sr-only" role="status" aria-live="polite">{status}</span>
    <small id={`${id}-help`}>{helpText}</small>
    <p className="location-credit">Locations by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> / <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a>{!compactDestination && <>, airports by <a href="https://ourairports.com/" target="_blank" rel="noreferrer">OurAirports</a></>}</p>
    {hint && <small id={`${id}-hint`}>{hint}</small>}
  </div>;
}
