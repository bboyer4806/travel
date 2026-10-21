"use client";

import { useState } from "react";
import type { Candidate, Destination, Snapshot } from "@/lib/types";
import { calculateAccommodation, calculateDestinationBudget, calculateHotelEstimate, calculateMiscellaneous } from "@/lib/budget";
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

export function DestinationBudget({ snapshot, destination }: { snapshot: Snapshot; destination: Destination }) {
  const estimate = calculateDestinationBudget(snapshot, destination.id);
  return <div className="destination-budget">
    {(destination.arrivalDate || destination.departureDate) && <p className="helper">Arrival: {destination.arrivalDate ?? "To be decided"} · Departure: {destination.departureDate ?? "To be decided"}</p>}
    <AccommodationSummary snapshot={snapshot} destination={destination} />
    <MiscellaneousSummary destination={destination} />
    <div className="destination-budget-total"><span>Destination {estimate.complete ? "estimate" : "partial estimate"}<small>Chosen stay, included ideas, and miscellaneous · whole party</small></span><strong><CurrencyTotals totals={estimate.totalsByCurrency} /></strong></div>
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
    <p className="helper">Exact arrival and departure dates determine hotel nights and the miscellaneous allowance. Stay notes are not used in these calculations.</p>
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
  </fieldset>;
}

