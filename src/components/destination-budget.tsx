"use client";

import { ChevronDown } from "lucide-react";
import { formatCalendarDate, sequenceDates } from "@/lib/trip-dates";
import { useId, useState, type ReactNode } from "react";
import type { FoodBudgetMode, ActivitiesBudgetMode, Candidate, Destination, DestinationVisit, Snapshot, Trip, TripStop } from "@/lib/types";
import { calculateFoodBudget, calculateFoodEstimate, calculateActivitiesBudget, calculateAccommodation, calculateDestinationBudget, calculateHotelEstimate, calculateMiscellaneous } from "@/lib/budget";
import { formatCurrency, MAX_AMOUNT_DOLLARS, minorAmountValue, parseMinorAmount } from "@/lib/money";

export function CurrencyTotals({ totals, empty = "Not estimated" }: { totals: Record<string, number>; empty?: string }) {
  const entries = Object.entries(totals).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? <span className="currency-totals">{entries.map(([currency, minor]) =>
    <span key={currency}>{formatCurrency(minor, currency)}</span>)}</span> : <>{empty}</>;
}

function dayLabel(days: number | null) {
  return days === null ? "Duration unknown" : String(days) + (days === 1 ? " budget day" : " budget days");
}

function MiscellaneousSummary({ destination }: { destination: Pick<DestinationVisit, "nights" | "miscDailyMinor" | "miscCurrency"> }) {
  const misc = calculateMiscellaneous(destination);
  return <dl className="misc-breakdown">
    <div><dt>Daily miscellaneous</dt><dd>{misc.dailyMinor !== null && misc.currency ? formatCurrency(misc.dailyMinor, misc.currency) : "Not estimated"}</dd></div>
    <div><dt>Allowance</dt><dd>{dayLabel(misc.days)}</dd></div>
    <div><dt>Miscellaneous subtotal</dt><dd>{misc.subtotalMinor !== null && misc.currency ? formatCurrency(misc.subtotalMinor, misc.currency) : "Not estimated"}</dd></div>
  </dl>;
}

function HotelEstimateSummary({ destination }: { destination: Pick<DestinationVisit, "nights" | "hotelNightlyMinor" | "hotelCurrency"> }) {
  const estimate = calculateHotelEstimate(destination);
  return <dl className="misc-breakdown">
    <div><dt>General nightly hotel estimate</dt><dd>{estimate.nightlyMinor !== null && estimate.currency ? formatCurrency(estimate.nightlyMinor, estimate.currency) : "Not estimated"}</dd></div>
    <div><dt>Hotel nights</dt><dd>{estimate.nights === null ? "Nights unknown" : estimate.nights}</dd></div>
    <div><dt>General stay estimate</dt><dd>{estimate.subtotalMinor !== null && estimate.currency ? formatCurrency(estimate.subtotalMinor, estimate.currency) : "Not estimated"}</dd></div>
  </dl>;
}

export function AccommodationSummary({ snapshot, destination }: { snapshot: Snapshot; destination: DestinationVisit }) {
  const accommodation = calculateAccommodation(snapshot, destination);
  return <div className="accommodation-summary">
    <HotelEstimateSummary destination={destination} />
    <div className="destination-budget-total"><span>Accommodation in budget<small>{accommodation.hotel ? "Selected hotel: " + accommodation.hotel.name : "Using general nightly estimate"}</small></span><strong>{accommodation.totalMinor !== null && accommodation.currency ? formatCurrency(accommodation.totalMinor, accommodation.currency) : "Not estimated"}</strong></div>
    {accommodation.hotel && <p className="helper">The selected hotel’s whole-stay price replaces the general estimate. Uncheck it to use the saved nightly estimate again.</p>}
  </div>;
}

export function ActivitiesSummary({ snapshot, destination }: { snapshot: Snapshot; destination: Destination }) {
  const activities = calculateActivitiesBudget(snapshot, destination);
  return <div className="activities-summary">
    <dl className="misc-breakdown"><div><dt>Saved general activities budget</dt><dd>{destination.activitiesGeneralMinor !== null && destination.activitiesCurrency ? formatCurrency(destination.activitiesGeneralMinor, destination.activitiesCurrency) : "Not estimated"}</dd></div></dl>
    <div className="destination-budget-total"><span>Activities in budget<small>{activities.mode === "general" ? "General budget" : "Itemized activity costs"} · whole party, entire stay</small></span><strong><CurrencyTotals totals={activities.totalsByCurrency} empty={activities.complete ? "$0" : "Not estimated"} /></strong></div>
    {activities.missingCount > 0 && <p className="helper">{activities.mode === "general" ? "General activities amount not estimated." : activities.missingCount + " included " + (activities.missingCount === 1 ? "activity needs a price." : "activities need prices.")}</p>}
  </div>;
}

export function ActivitiesBudgetEditor({ destination, disabled }: { destination?: Destination; disabled: boolean }) {
  const [mode, setMode] = useState<ActivitiesBudgetMode>(destination?.activitiesBudgetMode ?? "itemized");
  const currency = "USD";
  const [amount, setAmount] = useState(minorAmountValue(destination?.activitiesGeneralMinor, destination?.activitiesCurrency));
  let minor: number | null = null;
  let error = "";
  try { minor = parseMinorAmount(amount, currency || null, "General activities amount"); }
  catch (cause) { error = cause instanceof Error ? cause.message : "Enter a valid general activities amount."; }
  return <fieldset className="destination-budget-editor wide" disabled={disabled}>
    <legend>Activities budget</legend>
    <div className="form-grid">
      <label className="field wide"><span>Activities budgeting method</span><select name="activitiesBudgetMode" value={mode} onChange={(event) => setMode(event.target.value as ActivitiesBudgetMode)}><option value="itemized">Itemized activity costs</option><option value="general">General budget</option></select><small>Switching keeps your general amount and all activity ideas and selections.</small></label>
      <label className="field"><span>General activities amount ($)</span><input name="activitiesGeneralAmount" type="number" min="0" max={MAX_AMOUNT_DOLLARS} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Not estimated" /><small>Total for the whole party for the entire stay. Zero is accepted; leave blank if unknown.</small></label>
    </div>
    <div aria-live="polite"><p className="helper">{error || (mode === "general" ? "General budget contribution: " + (minor !== null && currency ? formatCurrency(minor, currency) : "Not estimated") + ". Individual activity costs are excluded." : "Included activity costs supply the budget. The general amount stays saved for later.")}</p></div>
    <p className="helper">Editing activities does not switch methods. Dates and traveler count never multiply the general amount.</p>
  </fieldset>;
}

function FoodEstimateSummary({ destination }: { destination: Pick<DestinationVisit, "nights" | "foodDailyMinor" | "foodCurrency"> }) {
  const estimate = calculateFoodEstimate(destination);
  return <dl className="misc-breakdown">
    <div><dt>Saved daily food amount</dt><dd>{estimate.dailyMinor !== null && estimate.currency ? formatCurrency(estimate.dailyMinor, estimate.currency) : "Not estimated"}</dd></div>
    <div><dt>Food allowance</dt><dd>{dayLabel(estimate.days)}</dd></div>
    <div><dt>Daily food subtotal</dt><dd>{estimate.subtotalMinor !== null && estimate.currency ? formatCurrency(estimate.subtotalMinor, estimate.currency) : "Not estimated"}</dd></div>
  </dl>;
}

export function FoodSummary({ snapshot, destination }: { snapshot: Snapshot; destination: DestinationVisit }) {
  const food = calculateFoodBudget(snapshot, destination);
  return <div className="food-summary">
    <FoodEstimateSummary destination={destination} />
    <div className="destination-budget-total"><span>Food in budget<small>{food.mode === "daily" ? "Daily food budget" : "Itemized restaurant costs"} · whole party</small></span><strong><CurrencyTotals totals={food.totalsByCurrency} empty={food.complete ? "$0" : "Not estimated"} /></strong></div>
    {food.missingCount > 0 && <p className="helper">{food.mode === "daily" ? "Add a daily food amount and nights to estimate food." : food.missingCount + " included " + (food.missingCount === 1 ? "restaurant needs a price." : "restaurants need prices.")}</p>}
  </div>;
}

/** `nights` are the stay the preview uses: one trip's, or unknown outside a trip. */
export function FoodBudgetEditor({ destination, nights, disabled }: { destination?: Destination; nights: number | null; disabled: boolean }) {
  const [mode, setMode] = useState<FoodBudgetMode>(destination?.foodBudgetMode ?? "itemized");
  const currency = "USD";
  const [amount, setAmount] = useState(minorAmountValue(destination?.foodDailyMinor, destination?.foodCurrency));
  let foodDailyMinor: number | null = null;
  let error = "";
  try { foodDailyMinor = parseMinorAmount(amount, currency || null, "Daily food amount"); }
  catch (cause) { error = cause instanceof Error ? cause.message : "Enter a valid daily food amount."; }
  return <fieldset className="destination-budget-editor wide" disabled={disabled}>
    <legend>Food budget</legend>
    <div className="form-grid">
      <label className="field wide"><span>Food budgeting method</span><select name="foodBudgetMode" value={mode} onChange={(event) => setMode(event.target.value as FoodBudgetMode)}><option value="itemized">Itemized restaurant costs</option><option value="daily">Daily food budget</option></select><small>Switching keeps your daily amount and all restaurant ideas and selections.</small></label>
      <label className="field"><span>Daily food amount ($)</span><input name="foodDailyAmount" type="number" min="0" max={MAX_AMOUNT_DOLLARS} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Not estimated" /><small>For the whole party each day. Zero is accepted; leave blank if unknown.</small></label>
    </div>
    <div aria-live="polite">
      {error ? <p className="helper">{error}</p> : <FoodEstimateSummary destination={{ nights, foodDailyMinor, foodCurrency: currency || null }} />}
      <p className="helper">{mode === "daily" ? "The daily food subtotal supplies the budget. Itemized restaurant costs are excluded." : "Included restaurant costs supply the budget. The daily amount stays saved for later."}</p>
    </div>
    <p className="helper">Overnight stays use one budget day per night. A zero-night visit uses one full budget day. Each trip&apos;s nights for this destination set its allowance.</p>
    <p className="helper">Restaurant changes never switch methods. Traveler count never multiplies the daily amount.</p>
  </fieldset>;
}

export function ShoppingBudgetEditor({ destination, disabled }: { destination?: Destination; disabled: boolean }) {
  const currency = "USD";
  const [amount, setAmount] = useState(minorAmountValue(destination?.shoppingMinor, destination?.shoppingCurrency));
  let minor: number | null = null;
  let error = "";
  try { minor = parseMinorAmount(amount, currency || null, "Shopping amount"); }
  catch (cause) { error = cause instanceof Error ? cause.message : "Enter a valid shopping amount."; }
  return <fieldset className="destination-budget-editor wide" disabled={disabled}>
    <legend>Shopping budget</legend>
    <div className="form-grid">
      <label className="field"><span>Shopping amount ($, optional)</span><input name="shoppingAmount" type="number" min="0" max={MAX_AMOUNT_DOLLARS} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Not set" /><small>Total for the whole party for the entire stay. Zero is accepted; leave blank to add no shopping cost.</small></label>
    </div>
    <div aria-live="polite"><p className="helper">{error || "Shopping contribution: " + (minor !== null && currency ? formatCurrency(minor, currency) : "Not set")}</p></div>
    <p className="helper">Counted once, separately from miscellaneous spending. Dates and traveler count never multiply this amount.</p>
  </fieldset>;
}

/**
 * One budget category at a glance: its name, its amount, and any editor that changes it. Accommodation, Activities and
 * Food have none here: their sections below the budget edit them (TRA-120).
 */
function BudgetCategory({ name, amount, partial = false, action }: { name: string; amount: ReactNode; partial?: boolean; action?: ReactNode }) {
  return <div className="budget-category"><dt>{name}{partial && <small>Partial estimate</small>}</dt><dd className="budget-category-amount">{amount}</dd>{action && <dd className="budget-category-action">{action}</dd>}</div>;
}

/**
 * A destination's budget. In a trip, `stop` gives that stay's dates and nights. Outside a trip there are no nights, so
 * the duration-based subtotals and the destination estimate wait for one. Dates, each category's amount with any
 * editor, and the destination estimate always show. The Budget heading shows or hides the breakdowns, which start
 * hidden on every page load; toggling saves nothing.
 */
export function DestinationBudget({ snapshot, visit, stop, onShoppingEdit, onMiscellaneousEdit }: { snapshot: Snapshot; visit: DestinationVisit; stop?: TripStop; onShoppingEdit: () => void; onMiscellaneousEdit: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const accommodation = calculateAccommodation(snapshot, visit);
  const activities = calculateActivitiesBudget(snapshot, visit);
  const food = calculateFoodBudget(snapshot, visit);
  const misc = calculateMiscellaneous(visit);
  const estimate = calculateDestinationBudget(snapshot, visit);
  const shopping = visit.shoppingMinor !== null && visit.shoppingCurrency ? formatCurrency(visit.shoppingMinor, visit.shoppingCurrency) : "Not set";
  return <div className="destination-budget">
    {stop ? <DestinationDates stop={stop} /> : <p className="helper">Nights and dates belong to each trip, so stay totals appear on each trip&apos;s page. Budget amounts, methods and selections here are shared by every trip that visits this destination.</p>}
    <div className="budget-section-heading"><h4><button type="button" className="budget-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((open) => !open)}>Budget<ChevronDown size={18} aria-hidden="true" /></button></h4></div>
    <dl className="budget-categories">
      <BudgetCategory name="Accommodation" amount={accommodation.totalMinor !== null && accommodation.currency ? formatCurrency(accommodation.totalMinor, accommodation.currency) : "Not estimated"} />
      <BudgetCategory name="Activities" amount={<CurrencyTotals totals={activities.totalsByCurrency} empty={activities.complete ? "$0" : "Not estimated"} />} partial={!activities.complete && activities.knownCount > 0} />
      <BudgetCategory name="Food" amount={<CurrencyTotals totals={food.totalsByCurrency} empty={food.complete ? "$0" : "Not estimated"} />} partial={!food.complete && food.knownCount > 0} />
      <BudgetCategory name="Shopping" amount={shopping} action={<button type="button" className="text-button" onClick={onShoppingEdit}>Edit shopping budget<span className="sr-only"> for {visit.city}</span></button>} />
      <BudgetCategory name="Miscellaneous" amount={misc.subtotalMinor !== null && misc.currency ? formatCurrency(misc.subtotalMinor, misc.currency) : "Not estimated"} action={<button type="button" className="text-button" onClick={onMiscellaneousEdit}>Edit miscellaneous budget<span className="sr-only"> for {visit.city}</span></button>} />
    </dl>
    {stop && <div className="destination-budget-total"><span>Destination {estimate.complete ? "estimate" : "partial estimate"}<small>Accommodation, activities, food, shopping, and miscellaneous · whole party</small></span><strong><CurrencyTotals totals={estimate.totalsByCurrency} /></strong></div>}
    <div id={detailsId} className="destination-budget-details" hidden={!expanded}>
      <h5>Accommodation</h5>
      <AccommodationSummary snapshot={snapshot} destination={visit} />
      <h5>Activities</h5>
      <ActivitiesSummary snapshot={snapshot} destination={visit} />
      <h5>Food</h5>
      <FoodSummary snapshot={snapshot} destination={visit} />
      <h5>Shopping</h5>
      <div className="destination-budget-total"><span>Shopping<small>Optional · whole party, entire stay</small></span><strong>{shopping}</strong></div>
      <h5>Miscellaneous</h5>
      <MiscellaneousSummary destination={visit} />
    </div>
  </div>;
}

/** One trip's stay at a destination while it is edited: the trip, its stops in route order, and the stop. */
type TripStay = { trip: Trip; stops: TripStop[]; stop: TripStop };

/** A stay's nights while editing: the text as typed, and `value`, the number previews use, unknown while blank or outside a trip. */
function useStayNights(stay: TripStay | undefined) {
  const [input, setInput] = useState(String(stay?.stop.nights ?? ""));
  return { input, setInput, value: !stay || input === "" ? null : Number(input) };
}

/** A trip stay's Nights field, with a preview of the dates they give it. */
function StayNightsField({ stay, nights }: { stay: TripStay; nights: ReturnType<typeof useStayNights> }) {
  const previewStops = stay.stops.map((stop) => stop.id === stay.stop.id ? { ...stop, nights: nights.value } : stop);
  let dates = { arrivalDate: null as string | null, departureDate: null as string | null };
  let dateError = "";
  try { dates = sequenceDates(stay.trip.startDate, previewStops).destinations.find((stop) => stop.id === stay.stop.id) ?? dates; }
  catch (cause) { dateError = cause instanceof Error ? cause.message : "Enter valid nights."; }
  return <>
    <label className="field wide"><span>Nights</span><input name="nights" type="number" min="0" max="3652058" step="1" value={nights.input} onChange={(event) => nights.setInput(event.target.value)} placeholder="Unknown" /><small>Zero is a same-day visit. Leave blank if undecided.</small></label>
    <div className="wide" aria-live="polite"><DestinationDates stop={{ ...dates, nights: nights.value, legacyArrivalDate: stay.stop.legacyArrivalDate, legacyDepartureDate: stay.stop.legacyDepartureDate }} />{dateError && <p className="form-error">{dateError}</p>}</div>
  </>;
}

/** The general nightly hotel estimate, with a preview of the stay estimate it gives for `nights`. */
function HotelEstimateFields({ destination, selectedHotel, nights }: { destination?: Destination; selectedHotel?: Candidate; nights: number | null }) {
  const hotelCurrency = "USD";
  const [hotelAmount, setHotelAmount] = useState(minorAmountValue(destination?.hotelNightlyMinor, destination?.hotelCurrency));
  let hotelNightlyMinor: number | null = null;
  let hotelError = "";
  try { hotelNightlyMinor = parseMinorAmount(hotelAmount, hotelCurrency || null, "Nightly hotel amount"); }
  catch (error) { hotelError = error instanceof Error ? error.message : "Enter a valid nightly amount."; }
  return <>
    <label className="field"><span>Nightly hotel amount ($)</span><input name="hotelNightlyAmount" type="number" min="0" max={MAX_AMOUNT_DOLLARS} step="0.01" value={hotelAmount} onChange={(event) => setHotelAmount(event.target.value)} placeholder="Not estimated" /><small>General estimate for all rooms and travelers per night. Leave blank if unknown.</small></label>
    <div className="wide" aria-live="polite">
      {hotelError ? <p className="helper">{hotelError}</p> : <HotelEstimateSummary destination={{ nights, hotelNightlyMinor, hotelCurrency: hotelCurrency || null }} />}
      <p className="helper">{selectedHotel ? "Selected hotel: " + selectedHotel.name + ". Its whole-stay price stays in the budget; this general estimate is saved for when no hotel is selected." : "The general stay estimate is included until you select a hotel. A same-day visit has zero nights."}</p>
    </div>
  </>;
}

/** The daily miscellaneous amount, with a preview of the subtotal it gives for `nights`. */
function MiscellaneousFields({ destination, nights }: { destination?: Destination; nights: number | null }) {
  const currency = "USD";
  const [amount, setAmount] = useState(minorAmountValue(destination?.miscDailyMinor ?? null, destination?.miscCurrency ?? null));
  let dailyMinor: number | null = null;
  let previewError = "";
  try { dailyMinor = parseMinorAmount(amount.trim(), currency || null, "Daily miscellaneous amount"); }
  catch (error) { previewError = error instanceof Error ? error.message : "Enter a valid daily amount."; }
  return <>
    <label className="field"><span>Daily miscellaneous amount ($)</span><input name="miscDailyAmount" type="number" min="0" max={MAX_AMOUNT_DOLLARS} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Not estimated" /><small>For the whole party. Zero is accepted; leave blank if unknown.</small></label>
    <div className="wide" aria-live="polite">
      {previewError ? <p className="helper">{previewError}</p> : <MiscellaneousSummary destination={{ nights, miscDailyMinor: dailyMinor, miscCurrency: currency || null }} />}
    </div>
  </>;
}

/**
 * Budget amounts and methods, shared by every trip that visits the destination. In a trip, `stay` adds that trip's
 * nights for this stop, with previews of its dates.
 */
export function DestinationBudgetEditor({ destination, selectedHotel, disabled, stay }: { destination: Destination; selectedHotel?: Candidate; disabled: boolean; stay?: TripStay }) {
  const nights = useStayNights(stay);
  return <fieldset className="destination-budget-editor wide" disabled={disabled}>
    <legend>{stay ? "Dates & destination budget" : "Destination budget"}</legend>
    <p className="helper">{stay ? "Enter nights for this trip's stay. Dates follow the trip start and destination order automatically. " : "Each trip that visits this destination sets its own nights, which these amounts multiply. "}Budget amounts and methods are shared by every trip that visits this destination. All amounts are USD for the whole party; stay notes do not affect calculations.</p>
    <div className="form-grid">
      {stay && <StayNightsField stay={stay} nights={nights} />}
      <HotelEstimateFields destination={destination} selectedHotel={selectedHotel} nights={nights.value} />
      <MiscellaneousFields destination={destination} nights={nights.value} />
    </div>
    <p className="helper">Miscellaneous uses one budget day per night, or one full day for a zero-night visit. Unknown nights keep the estimate incomplete.</p>
    <ActivitiesBudgetEditor destination={destination} disabled={disabled} />
    <FoodBudgetEditor destination={destination} nights={nights.value} disabled={disabled} />
    <ShoppingBudgetEditor destination={destination} disabled={disabled} />
  </fieldset>;
}

/**
 * Accommodation's own editor: the general nightly hotel estimate, shared by every trip that visits the destination,
 * with a preview of the stay estimate. In a trip, `stay` adds that trip's nights for this stop, with previews of its dates.
 */
export function AccommodationBudgetEditor({ destination, selectedHotel, disabled, stay }: { destination: Destination; selectedHotel?: Candidate; disabled: boolean; stay?: TripStay }) {
  const nights = useStayNights(stay);
  return <fieldset className="destination-budget-editor wide" disabled={disabled}>
    <legend>Accommodation budget</legend>
    <p className="helper">{stay ? "Enter nights for this trip's stay. Dates follow the trip start and destination order automatically. " : "Each trip that visits this destination sets its own nights, which this amount multiplies. "}The nightly amount is shared by every trip that visits this destination. All amounts are USD for the whole party.</p>
    <div className="form-grid">
      {stay && <StayNightsField stay={stay} nights={nights} />}
      <HotelEstimateFields destination={destination} selectedHotel={selectedHotel} nights={nights.value} />
    </div>
  </fieldset>;
}

/** Miscellaneous's own editor. `nights` are the stay the preview uses: one trip's, or unknown outside a trip. */
export function MiscellaneousBudgetEditor({ destination, nights, disabled }: { destination: Destination; nights: number | null; disabled: boolean }) {
  return <fieldset className="destination-budget-editor wide" disabled={disabled}>
    <legend>Miscellaneous budget</legend>
    <div className="form-grid"><MiscellaneousFields destination={destination} nights={nights} /></div>
    <p className="helper">Miscellaneous uses one budget day per night, or one full day for a zero-night visit. Each trip&apos;s nights for this destination set its allowance; unknown nights keep the estimate incomplete.</p>
    <p className="helper">The daily amount is shared by every trip that visits this destination. Traveler count never multiplies it.</p>
  </fieldset>;
}

/** One trip's nights at a destination, with a preview of the dates they give. */
export function StayNightsEditor({ stay, disabled }: { stay: TripStay; disabled: boolean }) {
  const nights = useStayNights(stay);
  return <fieldset className="destination-budget-editor wide" disabled={disabled}>
    <legend>Nights &amp; dates</legend>
    <p className="helper">Enter nights for this trip&apos;s stay. Dates follow the trip start and destination order automatically. Other trips that visit this destination keep their own nights.</p>
    <div className="form-grid"><StayNightsField stay={stay} nights={nights} /></div>
  </fieldset>;
}


/** One trip's stay: its nights and calculated dates. */
export function DestinationDates({ stop }: { stop: Pick<TripStop, "arrivalDate" | "departureDate" | "nights" | "legacyArrivalDate" | "legacyDepartureDate"> }) {
  const complete = !!stop.arrivalDate && !!stop.departureDate;
  return <div className="destination-dates"><p>{stop.nights === null ? "Nights unknown" : stop.nights + (stop.nights === 1 ? " night" : " nights")}</p><dl className="misc-breakdown"><div><dt>Arrival</dt><dd>{formatCalendarDate(stop.arrivalDate)}</dd></div><div><dt>Departure</dt><dd>{formatCalendarDate(stop.departureDate)}</dd></div></dl>
    <p className="helper">{complete ? "Calculated from the trip start, destination order, and nights." : "Enter the trip start date and nights for this and every preceding destination to calculate dates."}</p>
    {!complete && (stop.legacyArrivalDate || stop.legacyDepartureDate) && <p className="helper">Previously recorded dates: {stop.legacyArrivalDate ?? "unknown"} → {stop.legacyDepartureDate ?? "unknown"}. Check these before completing the new schedule.</p>}
  </div>;
}
