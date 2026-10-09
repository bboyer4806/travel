"use client";

import { useId, useState } from "react";
import LocationField from "@/components/location-field";
import type { Trip } from "@/lib/types";

export default function TripRouteFields({ trip, disabled }: { trip?: Trip; disabled?: boolean }) {
  const id = useId();
  const [differentReturn, setDifferentReturn] = useState(trip?.returnCity != null);
  return <>
    <LocationField label="Departing city" name="homeCity" defaultValue={trip?.homeCity} disabled={disabled}
      hint={trip ? "Changing this city clears travel plans for the affected connections." : "Where will this trip begin?"} />
    <label className="checkbox-field wide">
      <input type="checkbox" name="differentReturn" checked={differentReturn} disabled={disabled}
        aria-controls={id} onChange={(event) => setDifferentReturn(event.target.checked)} />
      <span>Return to a different city<small>Otherwise, the trip returns to the departing city.</small></span>
    </label>
    <div id={id} className="wide" hidden={!differentReturn}>
      <LocationField label="Return city" name="returnCity" defaultValue={trip?.returnCity ?? ""}
        required={differentReturn} disabled={disabled || !differentReturn}
        placeholder="Where will this trip end?"
        hint={trip ? "Changing this city clears the return travel plan." : undefined} />
    </div>
  </>;
}
