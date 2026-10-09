"use client";

import { useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, MapPin, Plane, Plus, Trash2 } from "lucide-react";
import type { ItineraryStop } from "@/lib/types";

const MAX_STOPS = 30;

type EditorProps = {
  stops: ItineraryStop[];
  onChange: (stops: ItineraryStop[]) => void;
  disabled?: boolean;
};

export function ConnectionItineraryEditor({ stops, onChange, disabled = false }: EditorProps) {
  const id = useId();
  const focusPlace = useRef<string | null>(null);
  const addLayoverButton = useRef<HTMLButtonElement>(null);
  const [announcement, setAnnouncement] = useState("");

  function addStop(kind: ItineraryStop["kind"]) {
    if (disabled || stops.length >= MAX_STOPS) return;
    const stop: ItineraryStop = { id: crypto.randomUUID(), kind, place: "", arrival: "", departure: "", notes: "" };
    focusPlace.current = stop.id;
    onChange([...stops, stop]);
    setAnnouncement(`${kind === "layover" ? "Layover" : "Stop"} added at position ${stops.length + 1}.`);
  }

  function updateStop(stopId: string, patch: Partial<Omit<ItineraryStop, "id">>) {
    if (!disabled) onChange(stops.map((stop) => stop.id === stopId ? { ...stop, ...patch } : stop));
  }

  function moveStop(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (disabled || nextIndex < 0 || nextIndex >= stops.length) return;
    const reordered = [...stops];
    [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
    onChange(reordered);
    setAnnouncement(`${stops[index].place || "Stop"} moved to position ${nextIndex + 1}.`);
  }

  function removeStop(index: number) {
    if (disabled) return;
    const remaining = stops.filter((_, stopIndex) => stopIndex !== index);
    focusPlace.current = remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
    onChange(remaining);
    if (remaining.length === 0) addLayoverButton.current?.focus();
    setAnnouncement(`${stops[index].place || "Stop"} removed.`);
  }

  return <section className="connection-itinerary-editor wide" aria-labelledby={id + "-title"}>
    <div className="connection-itinerary-heading">
      <h3 id={id + "-title"}>Stops along the way</h3>
      <span>{stops.length} / {MAX_STOPS}</span>
    </div>
    <p id={id + "-help"} className="connection-itinerary-help">Add optional layovers or points of interest in travel order. The connection’s estimated price covers the full itinerary.</p>
    <div className="connection-itinerary-drafts">
      {stops.map((stop, index) => <fieldset className="connection-itinerary-draft" disabled={disabled} key={stop.id} aria-describedby={id + "-help"}>
        <legend>{index + 1}. {stop.kind === "layover" ? "Layover" : "Stop"}</legend>
        <div className="connection-itinerary-tools">
          <button type="button" className="icon-button" disabled={disabled || index === 0} aria-label={`Move stop ${index + 1} up`} onClick={() => moveStop(index, -1)}><ArrowUp size={16} /></button>
          <button type="button" className="icon-button" disabled={disabled || index === stops.length - 1} aria-label={`Move stop ${index + 1} down`} onClick={() => moveStop(index, 1)}><ArrowDown size={16} /></button>
          <button type="button" className="icon-button" disabled={disabled} aria-label={`Remove stop ${index + 1}`} onClick={() => removeStop(index)}><Trash2 size={16} /></button>
        </div>
        <div className="connection-itinerary-fields">
          <label className="field">
            <span>Stop type</span>
            <select id={`${id}-${stop.id}-kind`} value={stop.kind} onChange={(event) => updateStop(stop.id, { kind: event.target.value as ItineraryStop["kind"] })}>
              <option value="layover">Layover</option>
              <option value="stop">Point of interest / other stop</option>
            </select>
          </label>
          <label className="field">
            <span>Place</span>
            <input id={`${id}-${stop.id}-place`} required maxLength={160} value={stop.place} placeholder={stop.kind === "layover" ? "Airport or city, e.g. Frankfurt (FRA)" : "City, viewpoint, museum, or other stop"}
              ref={(node) => { if (node && focusPlace.current === stop.id) { focusPlace.current = null; node.focus(); } }}
              onChange={(event) => updateStop(stop.id, { place: event.target.value })} />
          </label>
          <div className="connection-itinerary-times">
            <label className="field"><span>Arrival at stop</span><input id={`${id}-${stop.id}-arrival`} maxLength={120} value={stop.arrival} placeholder="Date, time, or general plan" onChange={(event) => updateStop(stop.id, { arrival: event.target.value })} /></label>
            <label className="field"><span>Departure from stop</span><input id={`${id}-${stop.id}-departure`} maxLength={120} value={stop.departure} placeholder="Date, time, or general plan" onChange={(event) => updateStop(stop.id, { departure: event.target.value })} /></label>
          </div>
          <label className="field"><span>Stop notes</span><textarea id={`${id}-${stop.id}-notes`} rows={2} maxLength={2000} value={stop.notes} placeholder="Flight numbers, time to explore, or anything to remember…" onChange={(event) => updateStop(stop.id, { notes: event.target.value })} /></label>
        </div>
      </fieldset>)}
    </div>
    <div className="connection-itinerary-add">
      <button ref={addLayoverButton} type="button" className="button secondary small" disabled={disabled || stops.length >= MAX_STOPS} onClick={() => addStop("layover")}><Plane size={15} />Add layover</button>
      <button type="button" className="button secondary small" disabled={disabled || stops.length >= MAX_STOPS} onClick={() => addStop("stop")}><Plus size={15} />Add stop</button>
    </div>
    {stops.length >= MAX_STOPS && <p className="connection-itinerary-help">This connection has the maximum of {MAX_STOPS} stops.</p>}
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </section>;
}

export function ConnectionItinerary({ stops }: { stops: ItineraryStop[] }) {
  if (stops.length === 0) return null;
  return <ol className="connection-itinerary" aria-label="Stops along this connection">
    {stops.map((stop, index) => <li key={stop.id}>
      <span className="connection-itinerary-number" aria-hidden="true">{index + 1}</span>
      <div className="connection-itinerary-detail">
        <span className="connection-itinerary-kind">{stop.kind === "layover" ? <Plane size={12} aria-hidden="true" /> : <MapPin size={12} aria-hidden="true" />}{stop.kind === "layover" ? "Layover" : "Stop"}</span>
        <strong>{stop.place}</strong>
        {(stop.arrival || stop.departure) && <dl className="connection-itinerary-schedule">
          {stop.arrival && <div><dt>Arrive</dt><dd>{stop.arrival}</dd></div>}
          {stop.departure && <div><dt>Depart</dt><dd>{stop.departure}</dd></div>}
        </dl>}
        {stop.notes && <p className="preserve-lines">{stop.notes}</p>}
      </div>
    </li>)}
  </ol>;
}
