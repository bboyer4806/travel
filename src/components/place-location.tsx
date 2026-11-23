"use client";

import { useState } from "react";
import { ACCURACY_LABELS, COORDINATE_ACCURACIES, enteredCoordinates, formatCoordinates, sameCoordinates, type SavedCoordinates } from "@/lib/coordinates";
import styles from "./place-location.module.css";

/** What each accuracy means, in a place's editor. */
const ACCURACY_HINTS = {
  exact: "They mark the place itself.",
  approximate: "They mark only roughly where it is, as for a rental whose address is withheld. The map says so.",
};
/** Why the map doesn't use saved coordinates, in a place's details. */
const WAITING = "The address changed after they were saved, so the map doesn't use them until they're confirmed in the editor.";

/**
 * A hotel's, activity's, restaurant's or church's address and coordinates in its editor (TRA-150), which its form saves
 * as `address`, `latitude`, `longitude`, `accuracy`, and `coordinatesConfirmed`. A latitude or longitude needs the other
 * and an accuracy. Saved coordinates wait to be checked once the address is different from when they were saved, so
 * then a checkbox confirms them for it, unless they are changed or both cleared. `draft` is the form's fields as an
 * unsaved draft left them, which they start with instead of the saved address and coordinates (TRA-160).
 */
export function PlaceLocationFields({ label, placeholder, address, coordinates, draft, disabled }: {
  label: string; placeholder: string; address: string; coordinates: SavedCoordinates | null; draft?: FormData; disabled: boolean;
}) {
  /** A field's first value: as the draft left it, or as saved. */
  const initial = (name: string, saved: string) => draft ? String(draft.get(name) ?? "") : saved;
  const [addressText, setAddressText] = useState(initial("address", address));
  const [latitude, setLatitude] = useState(initial("latitude", coordinates ? String(coordinates.latitude) : ""));
  const [longitude, setLongitude] = useState(initial("longitude", coordinates ? String(coordinates.longitude) : ""));
  const [accuracy, setAccuracy] = useState<string>(initial("accuracy", coordinates?.accuracy ?? ""));
  const entered = latitude.trim() !== "" || longitude.trim() !== "";
  const review = coordinates !== null && (coordinates.review || addressText.trim() !== address) && sameCoordinates(coordinates, enteredCoordinates(latitude, longitude, accuracy));
  return <>
    <label className="field wide"><span>{label}</span><input name="address" value={addressText} onChange={(event) => setAddressText(event.target.value)} maxLength={500} placeholder={placeholder} disabled={disabled} /></label>
    <fieldset className={"wide " + styles.coordinates} disabled={disabled}>
      <legend>Coordinates (optional)</legend>
      <p className="helper">The destination&apos;s map shows the place at its coordinates, however far away, instead of looking up its address or name. Most map apps show a spot&apos;s latitude and longitude when you select or long-press it. Clear both to remove them.</p>
      <div className={styles.degrees}>
        <label className="field"><span>Latitude</span><input name="latitude" type="number" className="no-spin-buttons" min="-90" max="90" step="any" required={entered} value={latitude} onChange={(event) => setLatitude(event.target.value)} /><small>From −90 to 90, negative south of the equator.</small></label>
        <label className="field"><span>Longitude</span><input name="longitude" type="number" className="no-spin-buttons" min="-180" max="180" step="any" required={entered} value={longitude} onChange={(event) => setLongitude(event.target.value)} /><small>From −180 to 180, negative west of Greenwich.</small></label>
      </div>
      <fieldset className={styles.accuracy}>
        <legend>Accuracy</legend>
        <div className={styles.choices}>
          {COORDINATE_ACCURACIES.map((value) => <label key={value} className={styles.choice}>
            <input type="radio" name="accuracy" value={value} checked={accuracy === value} onChange={() => setAccuracy(value)} required={entered} />
            <span>{ACCURACY_LABELS[value]}<small>{ACCURACY_HINTS[value]}</small></span>
          </label>)}
        </div>
      </fieldset>
      {review && <div className={styles.review}>
        <p>The address is different from when these coordinates were saved. Unless you confirm them for it, change them or clear them, the map won&apos;t use them.</p>
        <label className="checkbox-field"><input type="checkbox" name="coordinatesConfirmed" defaultChecked={draft?.has("coordinatesConfirmed")} /><span>These coordinates are right for this address</span></label>
      </div>}
    </fieldset>
  </>;
}

/** A place's saved coordinates in its details (TRA-150): where they are, how accurate, and whether they wait to be checked. */
export function CoordinatesDetail({ coordinates }: { coordinates: SavedCoordinates | null }) {
  if (!coordinates) return <>Not added</>;
  return <>{formatCoordinates(coordinates)}<small>{ACCURACY_LABELS[coordinates.accuracy] + (coordinates.review ? ". " + WAITING : "")}</small></>;
}
