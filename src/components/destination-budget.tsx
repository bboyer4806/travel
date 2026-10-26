"use client";

import { useState } from "react";
import type { FoodBudgetMode, ActivitiesBudgetMode, Candidate, Destination, Snapshot } from "@/lib/types";
import { calculateFoodBudget, calculateFoodEstimate, calculateActivitiesBudget, calculateAccommodation, calculateDestinationBudget, calculateHotelEstimate, calculateMiscellaneous } from "@/lib/budget";
import { currencyDigits, formatCurrency, minorAmountValue, parseMinorAmount, SUPPORTED_CURRENCIES } from "@/lib/money";

export function CurrencyTotals({ totals, empty = "Not estimated" }: { totals: Record<string, number>; empty?: string }) {
  const entries = Object.entries(totals).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? <span className="currency-totals">{entries.map(([currency, minor]) =>
    <span key={currency}>{formatCurrency(minor, currency)}</span>)}</span> : <>{empty}</>;
}

function dayLabel(days: number | null) {
  return days === null ? "Duration unknown" : (days === 0.5 ? "½" : String(days)) + (days === 1 ? " budget day" : " budget days");
}

function MiscellaneousSummary({ destination }: { destination: Pick<Destination, "arrivalDate" | "departureDate" | "miscDailyMinor" | "miscCurrency"> }) {
  const misc = calculateMiscellaneous(destination);
  return <dl className="misc-breakdown">
    <div><dt>Daily miscellaneous</dt><dd>{misc.dailyMinor !== null && misc.currency ? formatCurrency(misc.dailyMinor, misc.currency) : "Not estimated"}</dd></div>
    <div><dt>Allowance</dt><dd>{dayLabel(misc.days)}</dd></div>
    <div><dt>Miscellaneous subtotal</dt><dd>{misc.subtotalMinor !== null && misc.currency ? formatCurrency(misc.subtotalMinor, misc.currency) : "Not estimated"}</dd></div>
  </dl>;
}

function HotelEstimateSummary({ destination }: { destination: Pick<Destination, "arrivalDate" | "departureDate" | "hotelNightlyMinor" | "hotelCurrency"> }) {
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
    <div className="destination-budget-total"><span>Activities in budget<small>{activities.mode === "general" ? "General budget" : "Itemized activity costs"} · whole party, entire stay</small></span><strong><CurrencyTotals totals={activities.totalsByCurrency} empty={activities.complete ? "USD 0" : "Not estimated"} /></strong></div>
    {activities.missingCount > 0 && <p className="helper">{activities.mode === "general" ? "General activities amount not estimated." : activities.missingCount + " included " + (activities.missingCount === 1 ? "activity needs a price." : "activities need prices.")}</p>}
  </div>;
}

export function ActivitiesBudgetEditor({ destination, disabled }: { destination?: Destination; disabled: boolean }) {
  const [mode, setMode] = useState<ActivitiesBudgetMode>(destination?.activitiesBudgetMode ?? "itemized");
  const [currency, setCurrency] = useState(destination ? destination.activitiesCurrency ?? "" : "USD");
  const [amount, setAmount] = useState(minorAmountValue(destination?.activitiesGeneralMinor, destination?.activitiesCurrency));
  let minor: number | null = null;
  let error = "";
  try { minor = parseMinorAmount(amount, currency || null, "General activities amount"); }
  catch (cause) { error = cause instanceof Error ? cause.message : "Enter a valid general activities amount."; }
  return <fieldset className="destination-budget-editor wide" disabled={disabled}>
    <legend>Activities budget</legend>
    <div className="form-grid">
      <label className="field wide"><span>Activities budgeting method</span><select name="activitiesBudgetMode" value={mode} onChange={(event) => setMode(event.target.value as ActivitiesBudgetMode)}><option value="itemized">Itemized activity costs</option><option value="general">General budget</option></select><small>Switching keeps your general amount and all activity ideas and selections.</small></label>
      <label className="field"><span>General activities amount</span><input name="activitiesGeneralAmount" type="number" min="0" max="100000000" step={currency ? 10 ** -currencyDigits(currency) : "any"} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Not estimated" /><small>Total for the whole party for the entire stay. Zero is accepted; leave blank if unknown.</small></label>
      <label className="field"><span>Activities budget currency</span><select name="activitiesCurrency" value={currency} onChange={(event) => setCurrency(event.target.value)} required={amount.trim() !== ""}><option value="">No currency selected</option>{SUPPORTED_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}</select><small>Currencies stay separate; no conversion is applied.</small></label>
    </div>
    <div aria-live="polite"><p className="helper">{error || (mode === "general" ? "General budget contribution: " + (minor !== null && currency ? formatCurrency(minor, currency) : "Not estimated") + ". Individual activity costs are excluded." : "Included activity costs supply the budget. The general amount stays saved for later.")}</p></div>
    <p className="helper">Editing activities does not switch methods. Dates and traveler count never multiply the general amount.</p>
  </fieldset>;
}

function FoodEstimateSummary({ destination }: { destination: Pick<Destination, "arrivalDate" | "departureDate" | "foodDailyMinor" | "foodCurrency"> }) {
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
    <div className="destination-budget-total"><span>Food in budget<small>{food.mode === "daily" ? "Daily food budget" : "Itemized restaurant costs"} · whole party</small></span><strong><CurrencyTotals totals={food.totalsByCurrency} empty={food.complete ? "USD 0" : "Not estimated"} /></strong></div>
    {food.missingCount > 0 && <p className="helper">{food.mode === "daily" ? "Add a daily food amount, currency, and both dates to estimate food." : food.missingCount + " included " + (food.missingCount === 1 ? "restaurant needs a price." : "restaurants need prices.")}</p>}
  </div>;
}

export function FoodBudgetEditor({ destination, arrivalDate = destination?.arrivalDate ?? null, departureDate = destination?.departureDate ?? null, disabled }: { destination?: Destination; arrivalDate?: string | null; departureDate?: string | null; disabled: boolean }) {
  const [mode, setMode] = useState<FoodBudgetMode>(destination?.foodBudgetMode ?? "itemized");
  const [currency, setCurrency] = useState(destination ? destination.foodCurrency ?? "" : "USD");
  const [amount, setAmount] = useState(minorAmountValue(destination?.foodDailyMinor, destination?.foodCurrency));
  let foodDailyMinor: number | null = null;
  let error = "";
  try { foodDailyMinor = parseMinorAmount(amount, currency || null, "Daily food amount"); }
  catch (cause) { error = cause instanceof Error ? cause.message : "Enter a valid daily food amount."; }
  return <fieldset className="destination-budget-editor wide" disabled={disabled}>
    <legend>Food budget</legend>
    <div className="form-grid">
      <label className="field wide"><span>Food budgeting method</span><select name="foodBudgetMode" value={mode} onChange={(event) => setMode(event.target.value as FoodBudgetMode)}><option value="itemized">Itemized restaurant costs</option><option value="daily">Daily food budget</option></select><small>Switching keeps your daily amount and all restaurant ideas and selections.</small></label>
      <label className="field"><span>Daily food amount</span><input name="foodDailyAmount" type="number" min="0" max="100000000" step={currency ? 10 ** -currencyDigits(currency) : "any"} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Not estimated" /><small>For the whole party each day. Zero is accepted; leave blank if unknown.</small></label>
      <label className="field"><span>Food budget currency</span><select name="foodCurrency" value={currency} onChange={(event) => setCurrency(event.target.value)} required={amount.trim() !== ""}><option value="">No currency selected</option>{SUPPORTED_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}</select><small>Currencies stay separate; no conversion is applied.</small></label>
    </div>
    <div aria-live="polite">
      {error ? <p className="helper">{error}</p> : <FoodEstimateSummary destination={{ arrivalDate, departureDate, foodDailyMinor, foodCurrency: currency || null }} />}
      <p className="helper">{mode === "daily" ? "The daily food subtotal supplies the budget. Itemized restaurant costs are excluded." : "Included restaurant costs supply the budget. The daily amount stays saved for later."}</p>
    </div>
    <p className="helper">Arrival and departure count as ½ day each, or ½ day total for a same-day visit. Half a minor currency unit is rounded up per destination. Edit destination dates to change the allowance.</p>
    <p className="helper">Restaurant changes never switch methods. Traveler count never multiplies the daily amount.</p>
  </fieldset>;
}

export function DestinationBudget({ snapshot, destination }: { snapshot: Snapshot; destination: Destination }) {
  const estimate = calculateDestinationBudget(snapshot, destination.id);
  return <div className="destination-budget">
    {(destination.arrivalDate || destination.departureDate) && <p className="helper">Arrival: {destination.arrivalDate ?? "To be decided"} · Departure: {destination.departureDate ?? "To be decided"}</p>}
    <AccommodationSummary snapshot={snapshot} destination={destination} />
    <ActivitiesSummary snapshot={snapshot} destination={destination} />
    <FoodSummary snapshot={snapshot} destination={destination} />
    <MiscellaneousSummary destination={destination} />
    <div className="destination-budget-total"><span>Destination {estimate.complete ? "estimate" : "partial estimate"}<small>Accommodation, activities budget, food budget, and miscellaneous · whole party</small></span><strong><CurrencyTotals totals={estimate.totalsByCurrency} /></strong></div>
  </div>;
}

export function DestinationBudgetEditor({ destination, selectedHotel, disabled }: { destination?: Destination; selectedHotel?: Candidate; disabled: boolean }) {
  const [arrivalDate, setArrivalDate] = useState(destination?.arrivalDate ?? "");
  const [departureDate, setDepartureDate] = useState(destination?.departureDate ?? "");
  const [currency, setCurrency] = useState(destination ? destination.miscCurrency ?? "" : "USD");
  const [amount, setAmount] = useState(minorAmountValue(destination?.miscDailyMinor ?? null, destination?.miscCurrency ?? null));
  const [hotelCurrency, setHotelCurrency] = useState(destination ? destination.hotelCurrency ?? "" : "USD");
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
    <p className="helper">Exact arrival and departure dates determine hotel nights and the food and miscellaneous allowances. Stay notes are not used in these calculations.</p>
    <div className="form-grid">
      <label className="field"><span>Arrival date</span><input name="arrivalDate" type="date" min="0001-01-01" max="9999-12-31" value={arrivalDate} onChange={(event) => setArrivalDate(event.target.value)} /></label>
      <label className="field"><span>Departure date</span><input name="departureDate" type="date" min={arrivalDate || "0001-01-01"} max="9999-12-31" value={departureDate} onChange={(event) => setDepartureDate(event.target.value)} /></label>
      <label className="field"><span>Nightly hotel amount</span><input name="hotelNightlyAmount" type="number" min="0" max="100000000" step={hotelCurrency ? 10 ** -currencyDigits(hotelCurrency) : "any"} value={hotelAmount} onChange={(event) => setHotelAmount(event.target.value)} placeholder="Not estimated" /><small>General estimate for all rooms and travelers per night. Leave blank if unknown.</small></label>
      <label className="field"><span>Hotel estimate currency</span><select name="hotelCurrency" value={hotelCurrency} onChange={(event) => setHotelCurrency(event.target.value)} required={hotelAmount.trim() !== ""}><option value="">No currency selected</option>{SUPPORTED_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}</select><small>Currencies stay separate; no conversion is applied.</small></label>
      <div className="wide" aria-live="polite">
        {hotelError ? <p className="helper">{hotelError}</p> : <HotelEstimateSummary destination={{ arrivalDate: arrivalDate || null, departureDate: departureDate || null, hotelNightlyMinor, hotelCurrency: hotelCurrency || null }} />}
        <p className="helper">{selectedHotel ? "Selected hotel: " + selectedHotel.name + ". Its whole-stay price stays in the budget; this general estimate is saved for when no hotel is selected." : "The general stay estimate is included until you select a hotel. A same-day visit has zero nights."}</p>
      </div>
      <label className="field"><span>Daily miscellaneous amount</span><input name="miscDailyAmount" type="number" min="0" max="100000000" step={currency ? 10 ** -currencyDigits(currency) : "any"} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Not estimated" /><small>For the whole party. Zero is accepted; leave blank if unknown.</small></label>
      <label className="field"><span>Miscellaneous currency</span><select name="miscCurrency" value={currency} onChange={(event) => setCurrency(event.target.value)} required={amount.trim() !== ""}><option value="">No currency selected</option>{SUPPORTED_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}</select><small>Choose a currency when entering an amount. No currency conversion is applied.</small></label>
    </div>
    <div aria-live="polite">
      {previewError ? <p className="helper">{previewError}</p> : <MiscellaneousSummary destination={{ arrivalDate: arrivalDate || null, departureDate: departureDate || null, miscDailyMinor: dailyMinor, miscCurrency: currency || null }} />}
    </div>
    <p className="helper">Miscellaneous spending counts arrival and departure as ½ day each, or ½ day total for a same-day visit. Half of a minor currency unit is rounded up in each miscellaneous subtotal.</p>
    <ActivitiesBudgetEditor destination={destination} disabled={disabled} />
    <FoodBudgetEditor destination={destination} arrivalDate={arrivalDate || null} departureDate={departureDate || null} disabled={disabled} />
  </fieldset>;
}

