"use client";

import { useId, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CircleAlert, Clock, Pencil, Plus, Trash2 } from "lucide-react";
import { formatLayoverDay, formatLayoverTime, formatMinutes, formatUtcOffset, LAYOVER_BUFFERS, layoverPlanFromDraft, layoverSchedule, MAX_LAYOVER_ACTIVITIES, MAX_LAYOVER_MINUTES, normalizeLayoverPlan } from "@/lib/layover-plan";
import type { LayoverActivityDraft, LayoverPlan, LayoverPlanDraft, LayoverSchedule } from "@/lib/layover-plan";
import { randomUuid } from "@/lib/uuid";
import { controlOrNeighbor, useFocusAfter } from "./focus-after";
import styles from "./layover-plan.module.css";

/*
 * Layover plans (TRA-45): the editor of one layover's plan, its schedule, and its summary under the layover in Between
 * the places. Travelers enter everything; the schedule, time to spare and warnings follow from what they enter, and
 * every time but the flights' own is shown as an estimate.
 */

/** What every schedule says about its times, beside them. */
const ESTIMATES = "Only the flights' times are scheduled. Every other time is an estimate from what you entered, not a guarantee: allow for delays, lines and traffic.";

/** The plan a draft saves and its schedule, or why there is none yet: what checking the plan asks for first. */
function draftSchedule(draft: LayoverPlanDraft): { plan: LayoverPlan; schedule: LayoverSchedule } | { reason: string } {
  try {
    const plan = normalizeLayoverPlan(layoverPlanFromDraft(draft))!;
    return { plan, schedule: layoverSchedule(plan) };
  } catch (error) {
    return { reason: error instanceof Error ? error.message : "Check the plan." };
  }
}

/** A zone's offset from UTC at an instant, or nothing when this browser doesn't know the zone. */
function offsetLabel(zone: string, at: number): string {
  try { return ` (${formatUtcOffset(zone, at)})`; } catch { return ""; }
}

/**
 * The time zones this browser knows, and the saved one, by region, each named by its place, as "New York", with its
 * offset from UTC at `at`, the arrival's date, once that is entered.
 */
function zoneGroups(saved: string, at: number | null): [string, { value: string; label: string }[]][] {
  const known = Intl.supportedValuesOf("timeZone");
  const zones = saved && !known.includes(saved) ? [...known, saved].sort() : known;
  const groups = new Map<string, { value: string; label: string }[]>();
  for (const zone of zones) {
    const slash = zone.indexOf("/");
    const region = slash < 0 ? "Other" : zone.slice(0, slash);
    const place = (slash < 0 ? zone : zone.slice(slash + 1)).replaceAll("_", " ").replaceAll("/", " / ");
    groups.set(region, [...(groups.get(region) ?? []), { value: zone, label: place + (at === null ? "" : offsetLabel(zone, at)) }]);
  }
  return [...groups].sort(([a], [b]) => a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b));
}

/** Whether the plan reaches the gate in time, with the time to spare, or by how much it runs over and what that risks. */
export function LayoverStatus({ plan, schedule }: { plan: LayoverPlan; schedule: LayoverSchedule }) {
  if (schedule.spareMinutes >= 0) {
    return <p className={styles.status}>{formatMinutes(schedule.spareMinutes)} to spare before {plan.boardingMinutes > 0 ? "boarding" : "departure"} (estimated)</p>;
  }
  const over = formatMinutes(schedule.spareMinutes);
  return <p className={styles.status + " " + styles.warning}><CircleAlert size={15} aria-hidden="true" /><span><strong>Over by {over}.</strong> {schedule.missesFlight
    ? `This plan ends ${formatMinutes(plan.boardingMinutes + schedule.spareMinutes)} after your connecting flight departs.`
    : `You would reach the gate ${over} after boarding time and could miss your connecting flight.`}</span></p>;
}

/** A plan's schedule, in order, each step at the time the airport's clocks show, with its date where it changes. */
export function LayoverTimeline({ plan, schedule }: { plan: LayoverPlan; schedule: LayoverSchedule }) {
  const days = schedule.steps.map((step) => formatLayoverDay(step.start, plan.timeZone));
  return <ol className={styles.timeline} aria-label="Layover schedule">
    {schedule.steps.map((step, index) => <li key={index} className={[step.late && styles.late, step.kind === "spare" && styles.spare].filter(Boolean).join(" ") || undefined}>
      <span className={styles.time}>{formatLayoverTime(step.start, plan.timeZone)}{(index === 0 || days[index] !== days[index - 1]) && <span className={styles.day}>{days[index]}</span>}</span>
      <span className={styles.step}>{step.label}{(step.kind === "land" || step.kind === "depart") && <span className={styles.tag}>Scheduled</span>}{step.late && <span className={styles.tag + " " + styles.lateTag}>Late</span>}</span>
      {step.minutes > 0 && <span className={styles.minutes}>{formatMinutes(step.minutes)}</span>}
    </li>)}
  </ol>;
}

/** A layover's saved plan under its layover on the trip's page: its totals, its time to spare or warning, and its schedule. */
export function LayoverPlanSummary({ plan }: { plan: LayoverPlan }) {
  let schedule: LayoverSchedule;
  try { schedule = layoverSchedule(plan); }
  catch (error) { return <p className={styles.status + " " + styles.warning}><CircleAlert size={15} aria-hidden="true" />{error instanceof Error ? error.message : "This plan's schedule can't be worked out."}</p>; }
  const activities = plan.activities.length;
  return <div className={styles.summary}>
    <p className={styles.totals}><Clock size={13} aria-hidden="true" /><span>Layover {formatMinutes(schedule.layoverMinutes)}</span><span>Airport time {formatMinutes(schedule.airportMinutes)}</span>
      {schedule.travelMinutes > 0 && <span>Travel {formatMinutes(schedule.travelMinutes)}</span>}<span>{activities === 1 ? "1 activity" : activities + " activities"}{activities > 0 && ", " + formatMinutes(schedule.activityMinutes)}</span></p>
    <LayoverStatus plan={plan} schedule={schedule} />
    <details className={styles.details}><summary>Schedule, in {plan.timeZone}</summary><LayoverTimeline plan={plan} schedule={schedule} /><p className={styles.caption}>{ESTIMATES}</p></details>
  </div>;
}

/** A layover's plan and its controls, under the layover in Between the places: Plan layover, or the saved plan with Edit and Remove. */
export function LayoverPlanPanel({ place, plan, disabled, onEdit, onRemove }: { place: string; plan: LayoverPlan | undefined; disabled: boolean; onEdit: () => void; onRemove: () => void }) {
  if (!plan) return <div className={styles.tools}><button type="button" className="text-button" disabled={disabled} aria-label={"Plan your layover in " + place} onClick={onEdit}><Clock size={14} />Plan layover</button></div>;
  return <>
    <LayoverPlanSummary plan={plan} />
    <div className={styles.tools}>
      <button type="button" className="text-button" disabled={disabled} aria-label={"Edit the layover plan for " + place} onClick={onEdit}><Pencil size={14} />Edit plan</button>
      <button type="button" className="text-button muted" disabled={disabled} aria-label={"Remove the layover plan for " + place} onClick={onRemove}>Remove plan</button>
    </div>
  </>;
}

/** A number of minutes as typed: whole, from `min` to a day. */
function MinutesInput({ value, min, disabled, onChange }: { value: string; min: number; disabled: boolean; onChange: (value: string) => void }) {
  return <input type="number" inputMode="numeric" required min={min} max={MAX_LAYOVER_MINUTES} step="1" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
}

/**
 * The editor of a layover's plan, in the planner's dialog: the flights' scheduled times in the airport's time zone, the
 * traveler's estimates of airport time, starting at 0, and their activities, with the schedule worked out as they type.
 */
export function LayoverPlanEditor({ place, draft, onChange, disabled = false }: { place: string; draft: LayoverPlanDraft; onChange: (draft: LayoverPlanDraft) => void; disabled?: boolean }) {
  const id = useId();
  const focusName = useRef<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const focusAfter = useFocusAfter();
  const [announcement, setAnnouncement] = useState("");
  const arrivalClock = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(draft.arrival) ? Date.parse(draft.arrival + ":00.000Z") : NaN;
  const at = Number.isFinite(arrivalClock) ? arrivalClock : null;
  const groups = useMemo(() => zoneGroups(draft.timeZone, at), [draft.timeZone, at]);
  const result = draftSchedule(draft);
  const leaves = draft.activities.some((activity) => activity.outside);
  const full = draft.activities.length >= MAX_LAYOVER_ACTIVITIES;

  const set = (patch: Partial<LayoverPlanDraft>) => { if (!disabled) onChange({ ...draft, ...patch }); };
  const setActivity = (activityId: string, patch: Partial<Omit<LayoverActivityDraft, "id">>) =>
    set({ activities: draft.activities.map((activity) => activity.id === activityId ? { ...activity, ...patch } : activity) });
  function addActivity() {
    if (disabled || full) return;
    const activity: LayoverActivityDraft = { id: randomUuid(), name: "", place: "", outside: false, minutes: "", travelMinutes: "", notes: "" };
    focusName.current = activity.id;
    set({ activities: [...draft.activities, activity] });
    setAnnouncement(`Activity ${draft.activities.length + 1} added.`);
  }
  /** Moves an activity and keeps focus on `control`, or on the activity's other move at the first or last place. */
  function moveActivity(index: number, direction: -1 | 1, control: HTMLButtonElement) {
    const next = index + direction;
    if (disabled || next < 0 || next >= draft.activities.length) return;
    focusAfter(() => controlOrNeighbor(control));
    const activities = [...draft.activities];
    [activities[index], activities[next]] = [activities[next], activities[index]];
    set({ activities });
    setAnnouncement(`${draft.activities[index].name || "Activity"} moved to position ${next + 1}.`);
  }
  function removeActivity(index: number) {
    if (disabled) return;
    const activities = draft.activities.filter((_, other) => other !== index);
    focusName.current = activities[Math.min(index, activities.length - 1)]?.id ?? null;
    set({ activities });
    if (activities.length === 0) addButton.current?.focus();
    setAnnouncement(`${draft.activities[index].name || "Activity"} removed.`);
  }

  return <div className={"wide " + styles.editor}>
    <section className={styles.section} aria-labelledby={id + "-flights"}>
      <h3 id={id + "-flights"}>Flights</h3>
      <p className={styles.note}>The scheduled times from your booking, as the clocks at {place} show them.</p>
      <label className="field"><span>Airport time zone</span>
        <select required value={draft.timeZone} disabled={disabled} onChange={(event) => set({ timeZone: event.target.value })}>
          <option value="">Choose the airport&apos;s time zone</option>
          {groups.map(([region, zones]) => <optgroup key={region} label={region}>{zones.map((zone) => <option key={zone.value} value={zone.value}>{zone.label}</option>)}</optgroup>)}
        </select>
        <small>Both times are in this time zone, so daylight saving changes during the layover count.</small>
      </label>
      <div className={styles.pair}>
        <label className="field"><span>Arriving flight lands</span><input type="datetime-local" required min="0001-01-01T00:00" max="9999-12-31T23:59" value={draft.arrival} disabled={disabled} onChange={(event) => set({ arrival: event.target.value })} /></label>
        <label className="field"><span>Connecting flight departs</span><input type="datetime-local" required min="0001-01-01T00:00" max="9999-12-31T23:59" value={draft.departure} disabled={disabled} onChange={(event) => set({ departure: event.target.value })} /></label>
      </div>
      {"plan" in result && <p className={styles.length}><Clock size={15} aria-hidden="true" />Layover: {formatMinutes(result.schedule.layoverMinutes)}</p>}
    </section>

    <section className={styles.section} aria-labelledby={id + "-airport"}>
      <h3 id={id + "-airport"}>Airport time</h3>
      <p className={styles.note}>Your own estimates, in minutes. Travel doesn&apos;t supply any, so leave 0 for anything that doesn&apos;t apply.</p>
      <div className={styles.pair}>{LAYOVER_BUFFERS.map(({ name, label, hint }) => <label key={name} className="field"><span>{label} (minutes)</span>
        <MinutesInput value={draft[name]} min={0} disabled={disabled} onChange={(value) => set({ [name]: value })} /><small>{hint}</small></label>)}</div>
    </section>

    <section className={styles.section} aria-labelledby={id + "-activities"}>
      <div className={styles.heading}><h3 id={id + "-activities"}>Activities</h3><span>{draft.activities.length} / {MAX_LAYOVER_ACTIVITIES}</span></div>
      <p className={styles.note}>Add what you&apos;d like to do, in order. Activities outside the airport go one after another, in one trip out of the airport.</p>
      {draft.activities.length > 0 && <div className={styles.activities}>{draft.activities.map((activity, index) => <fieldset className={styles.activity} disabled={disabled} key={activity.id}>
        <legend>Activity {index + 1}</legend>
        <div className={styles.activityTools}>
          <button type="button" className="icon-button" disabled={disabled || index === 0} aria-label={`Move activity ${index + 1} up`} onClick={(event) => moveActivity(index, -1, event.currentTarget)}><ArrowUp size={16} /></button>
          <button type="button" className="icon-button" disabled={disabled || index === draft.activities.length - 1} aria-label={`Move activity ${index + 1} down`} onClick={(event) => moveActivity(index, 1, event.currentTarget)}><ArrowDown size={16} /></button>
          <button type="button" className="icon-button" disabled={disabled} aria-label={`Remove activity ${index + 1}`} onClick={() => removeActivity(index)}><Trash2 size={16} /></button>
        </div>
        <div className={styles.activityFields}>
          <label className="field"><span>What</span><input required maxLength={160} value={activity.name} placeholder="Lunch, a lounge, a walk in the old town…"
            ref={(node) => { if (node && focusName.current === activity.id) { focusName.current = null; node.focus(); } }}
            onChange={(event) => setActivity(activity.id, { name: event.target.value })} /></label>
          <label className="field"><span>Where (optional)</span><input maxLength={300} value={activity.place} placeholder="An address, or a terminal and gate" onChange={(event) => setActivity(activity.id, { place: event.target.value })} /></label>
          <label className="field"><span>In or outside the airport</span>
            <select value={activity.outside ? "outside" : "airport"} onChange={(event) => setActivity(activity.id, { outside: event.target.value === "outside" })}>
              <option value="airport">In the airport</option>
              <option value="outside">Outside the airport</option>
            </select>
          </label>
          <div className={styles.pair}>
            <label className="field"><span>Duration (minutes)</span><MinutesInput value={activity.minutes} min={1} disabled={disabled} onChange={(value) => setActivity(activity.id, { minutes: value })} /></label>
            {activity.outside && <label className="field"><span>Travel there (minutes)</span><MinutesInput value={activity.travelMinutes} min={0} disabled={disabled} onChange={(value) => setActivity(activity.id, { travelMinutes: value })} /><small>From the airport, or from the activity before it.</small></label>}
          </div>
          <label className="field"><span>Notes (optional)</span><textarea rows={2} maxLength={2000} value={activity.notes} onChange={(event) => setActivity(activity.id, { notes: event.target.value })} /></label>
        </div>
      </fieldset>)}</div>}
      <div className={styles.add}><button ref={addButton} type="button" className="button secondary small" disabled={disabled || full} onClick={addActivity}><Plus size={15} />Add activity</button></div>
      {full && <p className={styles.note}>This plan has the maximum of {MAX_LAYOVER_ACTIVITIES} activities.</p>}
      {leaves && <label className="field"><span>Travel back to the airport (minutes)</span><MinutesInput value={draft.returnMinutes} min={0} disabled={disabled} onChange={(value) => set({ returnMinutes: value })} /><small>From the last activity outside the airport.</small></label>}
    </section>

    <section className={styles.section} aria-labelledby={id + "-schedule"}>
      <h3 id={id + "-schedule"}>Schedule</h3>
      {"plan" in result ? <><LayoverStatus plan={result.plan} schedule={result.schedule} /><LayoverTimeline plan={result.plan} schedule={result.schedule} /><p className={styles.caption}>{ESTIMATES}</p></>
        : <p className={styles.note}>The schedule shows once the plan is complete. {result.reason}</p>}
    </section>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </div>;
}
