"use client";

import Link from "next/link";
import { formatCalendarDate, sequenceDates } from "@/lib/trip-dates";
import { useState } from "react";
import type { FoodBudgetMode, ActivitiesBudgetMode, Candidate, Destination, Snapshot, Trip } from "@/lib/types";
import { calculateFoodBudget, calculateFoodEstimate, calculateActivitiesBudget, calculateAccommodation, calculateDestinationBudget, calculateHotelEstimate, calculateMiscellaneous } from "@/lib/budget";
import { formatCurrency, minorAmountValue, parseMinorAmount } from "@/lib/money";

export function CurrencyTotals({ totals, empty = "Not estimated" }: { totals: Record<string, number>; empty?: string }) {
  const entries = Object.entries(totals).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? <span className="currency-totals">{entries.map(([currency, minor]) =>
    <span key={currency}>{formatCurrency(minor, currency)}</span>)}</span> : <>{empty}</>;
}

function dayLabel(days: number | null) {
  return days === null ? "Duration unknown" : (days === 0.5 ? "½" : String(days)) + (days === 1 ? " budget day" : " budget days");
}

function MiscellaneousSummary({ destination }: { destination: Pick<Destination, "nights" | "miscDailyMinor" | "miscCurrency"> }) {
  const misc = calculateMiscellaneous(destination);
  return <dl className="misc-breakdown">
    <div><dt>Daily miscellaneous</dt><dd>{misc.dailyMinor !== null && misc.currency ? formatCurrency(misc.dailyMinor, misc.currency) : "Not estimated"}</dd></div>
    <div><dt>Allowance</dt><dd>{dayLabel(misc.days)}</dd></div>
    <div><dt>Miscellaneous subtotal</dt><dd>{misc.subtotalMinor !== null && misc.currency ? formatCurrency(misc.subtotalMinor, misc.currency) : "Not estimated"}</dd></div>
  </dl>;
}

function HotelEstimateSummary({ destination }: { destination: Pick<Destination, "nights" | "hotelNightlyMinor" | "hotelCurrency"> }) {
  const estimate = calculateHotelEstimate(destination);
  return <dl className="misc-breakdown">
    <div><dt>General nightly hotel estimate</dt><dd>{estimate.nightlyMinor !== null && estimate.currency ? formatCurrency(estimate.nightlyMinor, estimate.currency) : "Not estimated"}</dd></div>
    <div><dt>Hotel nights</dt><dd>{estimate.nights === null ? "Nights unknown" : estimate.nights}</dd></div>
    <div><dt>General stay estimate</dt><dd>{estimate.subtotalMinor !== null && estimate.currency ? formatCurrency(estimate.subtotalMinor, estimate.currency) : "Not estimated"}</dd></div>
  </dl>;
}

export function AccommodationSummary({ snapshot, destination }: { snapshot: Snapshot; destination: Destination }) {
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
      <label className="field"><span>General activities amount ($)</span><input name="activitiesGeneralAmount" type="number" min="0" max="100000000" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Not estimated" /><small>Total for the whole party for the entire stay. Zero is accepted; leave blank if unknown.</small></label>
    </div>
    <div aria-live="polite"><p className="helper">{error || (mode === "general" ? "General budget contribution: " + (minor !== null && currency ? formatCurrency(minor, currency) : "Not estimated") + ". Individual activity costs are excluded." : "Included activity costs supply the budget. The general amount stays saved for later.")}</p></div>
    <p className="helper">Editing activities does not switch methods. Dates and traveler count never multiply the general amount.</p>
  </fieldset>;
}

function FoodEstimateSummary({ destination }: { destination: Pick<Destination, "nights" | "foodDailyMinor" | "foodCurrency"> }) {
  const estimate = calculateFoodEstimate(destination);
  return <dl className="misc-breakdown">
    <div><dt>Saved daily food amount</dt><dd>{estimate.dailyMinor !== null && estimate.currency ? formatCurrency(estimate.dailyMinor, estimate.currency) : "Not estimated"}</dd></div>
    <div><dt>Food allowance</dt><dd>{dayLabel(estimate.days)}</dd></div>
    <div><dt>Daily food subtotal</dt><dd>{estimate.subtotalMinor !== null && estimate.currency ? formatCurrency(estimate.subtotalMinor, estimate.currency) : "Not estimated"}</dd></div>
  </dl>;
}

export function FoodSummary({ snapshot, destination }: { snapshot: Snapshot; destination: Destination }) {
  const food = calculateFoodBudget(snapshot, destination);
  return <div className="food-summary">
    <FoodEstimateSummary destination={destination} />
    <div className="destination-budget-total"><span>Food in budget<small>{food.mode === "daily" ? "Daily food budget" : "Itemized restaurant costs"} · whole party</small></span><strong><CurrencyTotals totals={food.totalsByCurrency} empty={food.complete ? "$0" : "Not estimated"} /></strong></div>
    {food.missingCount > 0 && <p className="helper">{food.mode === "daily" ? "Add a daily food amount and nights to estimate food." : food.missingCount + " included " + (food.missingCount === 1 ? "restaurant needs a price." : "restaurants need prices.")}</p>}
  </div>;
}

export function FoodBudgetEditor({ destination, nights = destination?.nights ?? null, disabled }: { destination?: Destination; nights?: number | null; disabled: boolean }) {
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
      <label className="field"><span>Daily food amount ($)</span><input name="foodDailyAmount" type="number" min="0" max="100000000" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Not estimated" /><small>For the whole party each day. Zero is accepted; leave blank if unknown.</small></label>
    </div>
    <div aria-live="polite">
      {error ? <p className="helper">{error}</p> : <FoodEstimateSummary destination={{ nights, foodDailyMinor, foodCurrency: currency || null }} />}
      <p className="helper">{mode === "daily" ? "The daily food subtotal supplies the budget. Itemized restaurant costs are excluded." : "Included restaurant costs supply the budget. The daily amount stays saved for later."}</p>
    </div>
    <p className="helper">Overnight stays use one budget day per night. A zero-night visit uses one full budget day. Edit destination nights to change the allowance.</p>
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
      <label className="field"><span>Shopping amount ($, optional)</span><input name="shoppingAmount" type="number" min="0" max="100000000" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Not set" /><small>Total for the whole party for the entire stay. Zero is accepted; leave blank to add no shopping cost.</small></label>
    </div>
    <div aria-live="polite"><p className="helper">{error || "Shopping contribution: " + (minor !== null && currency ? formatCurrency(minor, currency) : "Not set")}</p></div>
    <p className="helper">Counted once, separately from miscellaneous spending. Dates and traveler count never multiply this amount.</p>
  </fieldset>;
}

export function DestinationBudget({ snapshot, destination, onShoppingEdit }: { snapshot: Snapshot; destination: Destination; onShoppingEdit: () => void }) {
  const estimate = calculateDestinationBudget(snapshot, destination.id);
  const categoryLink = (category: "hotels" | "activities" | "restaurants", title: string) => {
    const count = snapshot.candidates.filter((item) => item.destinationId === destination.id && item.category === category).length;
    return <div className="budget-section-heading"><h4>{title}</h4><Link className="text-button" href={"/trips/" + destination.tripId + "/destinations/" + destination.id + "/" + category}>{category === "hotels" ? "Hotels" : category === "activities" ? "Activities" : "Restaurants"} ({count})<span className="sr-only"> for {destination.city}</span> →</Link></div>;
  };
  return <div className="destination-budget">
    <DestinationDates destination={destination} />
    {categoryLink("hotels", "Accommodation")}
    <AccommodationSummary snapshot={snapshot} destination={destination} />
    {categoryLink("activities", "Activities")}
    <ActivitiesSummary snapshot={snapshot} destination={destination} />
    {categoryLink("restaurants", "Food")}
    <FoodSummary snapshot={snapshot} destination={destination} />
    <div className="budget-section-heading"><h4>Shopping</h4><button type="button" className="text-button" onClick={onShoppingEdit}>Edit shopping budget<span className="sr-only"> for {destination.city}</span></button></div>
    <div className="destination-budget-total"><span>Shopping<small>Optional · whole party, entire stay</small></span><strong>{destination.shoppingMinor !== null && destination.shoppingCurrency ? formatCurrency(destination.shoppingMinor, destination.shoppingCurrency) : "Not set"}</strong></div>
    <MiscellaneousSummary destination={destination} />
    <div className="destination-budget-total"><span>Destination {estimate.complete ? "estimate" : "partial estimate"}<small>Accommodation, activities, food, shopping, and miscellaneous · whole party</small></span><strong><CurrencyTotals totals={estimate.totalsByCurrency} /></strong></div>
  </div>;
}

export function DestinationBudgetEditor({ destination, selectedHotel, disabled, trip, stops }: { destination?: Destination; selectedHotel?: Candidate; disabled: boolean; trip: Trip; stops: Destination[] }) {
  const [nightInput, setNightInput] = useState(String(destination?.nights ?? ""));
  const nights = nightInput === "" ? null : Number(nightInput);
  const previewStops = destination ? stops.map((stop) => stop.id === destination.id ? { ...stop, nights } : stop) : [...stops, { id: "new", nights }];
  let dates = { arrivalDate: null as string | null, departureDate: null as string | null };
  let dateError = "";
  try { dates = sequenceDates(trip.startDate, previewStops).destinations.find((stop) => stop.id === (destination?.id ?? "new")) ?? dates; }
  catch (cause) { dateError = cause instanceof Error ? cause.message : "Enter valid nights."; }
  const currency = "USD";
  const [amount, setAmount] = useState(minorAmountValue(destination?.miscDailyMinor ?? null, destination?.miscCurrency ?? null));
  const hotelCurrency = "USD";
  const [hotelAmount, setHotelAmount] = useState(minorAmountValue(destination?.hotelNightlyMinor, destination?.hotelCurrency));
  let hotelNightlyMinor: number | null = null;
  let hotelError = "";
  try { hotelNightlyMinor = parseMinorAmount(hotelAmount, hotelCurrency || null, "Nightly hotel amount"); }
  catch (error) { hotelError = error instanceof Error ? error.message : "Enter a valid nightly amount."; }
  let dailyMinor: number | null = null;
  let previewError = "";
  try { dailyMinor = parseMinorAmount(amount.trim(), currency || null); }
  catch (error) { previewError = error instanceof Error ? error.message : "Enter a valid daily amount."; }

  return <fieldset className="destination-budget-editor wide" disabled={disabled}>
    <legend>Dates & destination budget</legend>
    <p className="helper">Enter nights for this destination. Dates follow the trip start and destination order automatically. All amounts are USD for the whole party; stay notes do not affect calculations.</p>
    <div className="form-grid">
      <label className="field wide"><span>Nights</span><input name="nights" type="number" min="0" max="3652058" step="1" value={nightInput} onChange={(event) => setNightInput(event.target.value)} placeholder="Unknown" /><small>Zero is a same-day visit. Leave blank if undecided.</small></label>
      <div className="wide" aria-live="polite"><DestinationDates destination={{ ...dates, nights, legacyArrivalDate: destination?.legacyArrivalDate ?? null, legacyDepartureDate: destination?.legacyDepartureDate ?? null }} />{dateError && <p className="form-error">{dateError}</p>}</div>
      <label className="field"><span>Nightly hotel amount ($)</span><input name="hotelNightlyAmount" type="number" min="0" max="100000000" step="0.01" value={hotelAmount} onChange={(event) => setHotelAmount(event.target.value)} placeholder="Not estimated" /><small>General estimate for all rooms and travelers per night. Leave blank if unknown.</small></label>
      <div className="wide" aria-live="polite">
        {hotelError ? <p className="helper">{hotelError}</p> : <HotelEstimateSummary destination={{ nights, hotelNightlyMinor, hotelCurrency: hotelCurrency || null }} />}
        <p className="helper">{selectedHotel ? "Selected hotel: " + selectedHotel.name + ". Its whole-stay price stays in the budget; this general estimate is saved for when no hotel is selected." : "The general stay estimate is included until you select a hotel. A same-day visit has zero nights."}</p>
      </div>
      <label className="field"><span>Daily miscellaneous amount ($)</span><input name="miscDailyAmount" type="number" min="0" max="100000000" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Not estimated" /><small>For the whole party. Zero is accepted; leave blank if unknown.</small></label>
    </div>
    <div aria-live="polite">
      {previewError ? <p className="helper">{previewError}</p> : <MiscellaneousSummary destination={{ nights, miscDailyMinor: dailyMinor, miscCurrency: currency || null }} />}
    </div>
    <p className="helper">Miscellaneous uses one budget day per night, or one full day for a zero-night visit. Unknown nights keep the estimate incomplete.</p>
    <ActivitiesBudgetEditor destination={destination} disabled={disabled} />
    <FoodBudgetEditor destination={destination} nights={nights} disabled={disabled} />
    <ShoppingBudgetEditor destination={destination} disabled={disabled} />
  </fieldset>;
}


export function DestinationDates({ destination }: { destination: Pick<Destination, "arrivalDate" | "departureDate" | "nights" | "legacyArrivalDate" | "legacyDepartureDate"> }) {
  const complete = !!destination.arrivalDate && !!destination.departureDate;
  return <div className="destination-dates"><p>{destination.nights === null ? "Nights unknown" : destination.nights + (destination.nights === 1 ? " night" : " nights")}</p><dl className="misc-breakdown"><div><dt>Arrival</dt><dd>{formatCalendarDate(destination.arrivalDate)}</dd></div><div><dt>Departure</dt><dd>{formatCalendarDate(destination.departureDate)}</dd></div></dl>
    <p className="helper">{complete ? "Calculated from the trip start, destination order, and nights." : "Enter the trip start date and nights for this and every preceding destination to calculate dates."}</p>
    {!complete && (destination.legacyArrivalDate || destination.legacyDepartureDate) && <p className="helper">Previously recorded dates: {destination.legacyArrivalDate ?? "unknown"} → {destination.legacyDepartureDate ?? "unknown"}. Check these before completing the new schedule.</p>}
  </div>;
}
