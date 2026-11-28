"use client";

import { useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, MapPin, Plane, Plus, Trash2 } from "lucide-react";
import { itineraryTarget } from "@/lib/trip-map";
import type { SavedLayoverPlan } from "@/lib/layover-plan";
import type { ItineraryStop } from "@/lib/types";
import { randomUuid } from "@/lib/uuid";
import { controlOrNeighbor, useFocusAfter } from "./focus-after";
import { LayoverPlanPanel } from "./layover-plan";

const MAX_STOPS = 30;

/**
 * Which of a connection's itinerary entries a part of its editor or card shows (TRA-184). A flight's layovers show with
 * its airline and flight number, and its other stops under Stops along the way. A connection that isn't a flight shows
 * every entry under Stops along the way, layovers included, so layovers saved while it was a flight stay there to edit.
 * Every part works on the connection's one itinerary, in its saved order.
 */
export type ItineraryGroup = "layovers" | "stops" | "all";

/** The part under Stops along the way: a flight's stops other than its layovers, or every entry of any other connection. */
export function groupAlongTheWay(flight: boolean): ItineraryGroup {
  return flight ? "stops" : "all";
}

function shows(group: ItineraryGroup, stop: Pick<ItineraryStop, "kind">): boolean {
  return group === "all" || (stop.kind === "layover") === (group === "layovers");
}

/** An entry as announcements name it: its place, or its kind before one is entered. */
function nameOf(stop: ItineraryStop): string {
  return stop.place || (stop.kind === "layover" ? "Layover" : "Stop");
}

/** The ID of an entry's fields in the connection's editor, unique among both of its parts. */
function draftTarget(stopId: string): string {
  return "itinerary-draft-" + stopId;
}

const EDITOR_PARTS: Record<ItineraryGroup, { title: string; help: string; item: string; adds: ItineraryStop["kind"][] }> = {
  layovers: { title: "Layovers", help: "Add the flight’s layovers in travel order. Once saved, each can have a plan from Plan layover on the trip page.", item: "layover", adds: ["layover"] },
  stops: { title: "Stops along the way", help: "Add optional points of interest or other stops in travel order. The connection’s estimated price covers the full itinerary.", item: "stop", adds: ["stop"] },
  all: { title: "Stops along the way", help: "Add optional layovers or points of interest in travel order. The connection’s estimated price covers the full itinerary.", item: "stop", adds: ["layover", "stop"] },
};

type EditorProps = {
  /** The entries this part shows. Its changes keep every other entry as it is, in its place. */
  group: ItineraryGroup;
  /** The connection's whole itinerary, in travel order. */
  stops: ItineraryStop[];
  onChange: (stops: ItineraryStop[]) => void;
  /** The saved layovers with a plan (TRA-45), which saving without them, or as other stops, removes. */
  planned: string[];
  disabled?: boolean;
};

/**
 * One part of a connection's itinerary in its editor (TRA-184): a flight's layovers, below its airline and flight number,
 * or what Stops along the way shows. Up and Down move an entry among this part's entries only, and an entry whose Stop
 * type moves it to the other part takes its place there in travel order, keeping focus.
 */
export function ConnectionItineraryEditor({ group, stops, onChange, planned, disabled = false }: EditorProps) {
  const id = useId();
  const focusPlace = useRef<string | null>(null);
  const firstAddButton = useRef<HTMLButtonElement>(null);
  const focusAfter = useFocusAfter();
  const [announcement, setAnnouncement] = useState("");
  const part = EDITOR_PARTS[group];
  const shown = stops.filter((stop) => shows(group, stop));
  const full = stops.length >= MAX_STOPS;

  function addStop(kind: ItineraryStop["kind"]) {
    if (disabled || full) return;
    const stop: ItineraryStop = { id: randomUuid(), kind, place: "", arrival: "", departure: "", notes: "" };
    focusPlace.current = stop.id;
    onChange([...stops, stop]);
    setAnnouncement(`${kind === "layover" ? "Layover" : "Stop"} added at position ${shown.length + 1}.`);
  }

  function updateStop(stopId: string, patch: Partial<Omit<ItineraryStop, "id">>) {
    if (!disabled) onChange(stops.map((stop) => stop.id === stopId ? { ...stop, ...patch } : stop));
  }

  /** Changes an entry's kind in its place. One that moves to the connection's other part keeps focus on its Stop type there. */
  function changeKind(stop: ItineraryStop, kind: ItineraryStop["kind"]) {
    if (disabled) return;
    if (!shows(group, { kind })) {
      focusAfter(() => document.getElementById(draftTarget(stop.id))?.querySelector("select"));
      setAnnouncement(`${nameOf(stop)} moved to ${kind === "layover" ? "Layovers, with the flight" : "Stops along the way"}.`);
    }
    updateStop(stop.id, { kind });
  }

  /**
   * Moves an entry among this part's entries and keeps focus on `control`, or on the entry's other move at the first or
   * last place. The two trade places in the whole itinerary, so the other part's entries keep theirs.
   */
  function moveStop(index: number, direction: -1 | 1, control: HTMLButtonElement) {
    const nextIndex = index + direction;
    if (disabled || nextIndex < 0 || nextIndex >= shown.length) return;
    focusAfter(() => controlOrNeighbor(control));
    const [from, to] = [stops.indexOf(shown[index]), stops.indexOf(shown[nextIndex])];
    const reordered = [...stops];
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    onChange(reordered);
    setAnnouncement(`${nameOf(shown[index])} moved to position ${nextIndex + 1}.`);
  }

  function removeStop(index: number) {
    if (disabled) return;
    const removed = shown[index];
    const remaining = shown.filter((_, other) => other !== index);
    focusPlace.current = remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
    onChange(stops.filter((stop) => stop.id !== removed.id));
    if (remaining.length === 0) firstAddButton.current?.focus();
    setAnnouncement(`${nameOf(removed)} removed.${planned.includes(removed.id) ? " Saving removes its layover plan." : ""}`);
  }

  return <section className={group === "layovers" ? "connection-itinerary-editor flight-layovers" : "connection-itinerary-editor wide"} aria-labelledby={id + "-title"}>
    <h3 id={id + "-title"}>{part.title}</h3>
    <p id={id + "-help"} className="connection-itinerary-help">{part.help}</p>
    <div className="connection-itinerary-drafts">
      {shown.map((stop, index) => <fieldset className="connection-itinerary-draft" id={draftTarget(stop.id)} disabled={disabled} key={stop.id} aria-describedby={id + "-help"}>
        <legend>{index + 1}. {stop.kind === "layover" ? "Layover" : "Stop"}</legend>
        <div className="connection-itinerary-tools">
          <button type="button" className="icon-button" disabled={disabled || index === 0} aria-label={`Move ${part.item} ${index + 1} up`} onClick={(event) => moveStop(index, -1, event.currentTarget)}><ArrowUp size={16} /></button>
          <button type="button" className="icon-button" disabled={disabled || index === shown.length - 1} aria-label={`Move ${part.item} ${index + 1} down`} onClick={(event) => moveStop(index, 1, event.currentTarget)}><ArrowDown size={16} /></button>
          <button type="button" className="icon-button" disabled={disabled} aria-label={`Remove ${part.item} ${index + 1}`} onClick={() => removeStop(index)}><Trash2 size={16} /></button>
        </div>
        <div className="connection-itinerary-fields">
          <label className="field">
            <span>Stop type</span>
            <select id={`${id}-${stop.id}-kind`} value={stop.kind} onChange={(event) => changeKind(stop, event.target.value as ItineraryStop["kind"])}>
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
          {planned.includes(stop.id) && <p className="connection-itinerary-help">This layover has a plan. Removing the layover, or changing it to another kind of stop, removes its plan when you save.</p>}
        </div>
      </fieldset>)}
    </div>
    <div className="connection-itinerary-add">
      {part.adds.map((kind, index) => <button key={kind} ref={index === 0 ? firstAddButton : undefined} type="button" className="button secondary small" disabled={disabled || full} onClick={() => addStop(kind)}>{kind === "layover" ? <><Plane size={15} />Add layover</> : <><Plus size={15} />Add stop</>}</button>)}
    </div>
    {full && <p className="connection-itinerary-help">This connection has the maximum of {MAX_STOPS} layovers and stops.</p>}
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </section>;
}

const LIST_LABELS: Record<ItineraryGroup, string> = { layovers: "Layovers on this flight", stops: "Stops along this connection", all: "Stops along this connection" };

/**
 * One part of a connection's itinerary on its card (TRA-184): a flight's layovers, below its airline and flight number, or
 * its other stops, or every entry of a connection that isn't a flight. Each entry is where the trip map's marker for it
 * leads (TRA-44), and each layover has its plan, or Plan layover (TRA-45).
 */
export function ConnectionItinerary({ group, legId, stops, plans, disabled, onPlan, onRemovePlan }: { group: ItineraryGroup; legId: string; stops: ItineraryStop[]; plans: SavedLayoverPlan[]; disabled: boolean; onPlan: (stop: ItineraryStop) => void; onRemovePlan: (stop: ItineraryStop) => void }) {
  const shown = stops.filter((stop) => shows(group, stop));
  if (shown.length === 0) return null;
  return <ol className="connection-itinerary" aria-label={LIST_LABELS[group]}>
    {shown.map((stop, index) => <li key={stop.id} id={itineraryTarget(legId, stop.id)} tabIndex={-1}>
      <span className="connection-itinerary-number" aria-hidden="true">{index + 1}</span>
      <div className="connection-itinerary-detail">
        <span className="connection-itinerary-kind">{stop.kind === "layover" ? <Plane size={12} aria-hidden="true" /> : <MapPin size={12} aria-hidden="true" />}{stop.kind === "layover" ? "Layover" : "Stop"}</span>
        <strong>{stop.place}</strong>
        {(stop.arrival || stop.departure) && <dl className="connection-itinerary-schedule">
          {stop.arrival && <div><dt>Arrive</dt><dd>{stop.arrival}</dd></div>}
          {stop.departure && <div><dt>Depart</dt><dd>{stop.departure}</dd></div>}
        </dl>}
        {stop.notes && <p className="preserve-lines">{stop.notes}</p>}
        {stop.kind === "layover" && <LayoverPlanPanel place={stop.place} plan={plans.find((plan) => plan.layoverId === stop.id)} disabled={disabled} onEdit={() => onPlan(stop)} onRemove={() => onRemovePlan(stop)} />}
      </div>
    </li>)}
  </ol>;
}
