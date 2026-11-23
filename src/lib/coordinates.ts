/**
 * Coordinates saved for a hotel, activity, restaurant or church (TRA-150): where its destination's map shows it when it
 * can't find its address, or it has none (TRA-163), and whether they mark the place itself or only roughly where it is.
 * People enter them in the place's editor, or approve them from ChatGPT or Claude. Travel never looks them up, estimates
 * them or checks them.
 */

/** Whether coordinates mark the place itself, or only roughly where it is, as for a rental whose address is withheld. */
export const COORDINATE_ACCURACIES = ["exact", "approximate"] as const;
export type CoordinatesAccuracy = typeof COORDINATE_ACCURACIES[number];
export const ACCURACY_LABELS: Record<CoordinatesAccuracy, string> = { exact: "Exact", approximate: "Approximate" };

/** A place's latitude and longitude in degrees, north and east positive, and how exactly they place it. */
export interface Coordinates { latitude: number; longitude: number; accuracy: CoordinatesAccuracy; }

/**
 * Coordinates as saved. `review` is true once the place's address changed after they were saved: the map doesn't use
 * them until they are saved again for the new address, or removed.
 */
export interface SavedCoordinates extends Coordinates { review: boolean; }

function degrees(value: unknown, limit: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
}

/** Coordinates a change gives, checked: a latitude and a longitude together, within range, and an accuracy. Null removes them. */
export function normalizeCoordinates(value: unknown): Coordinates | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter coordinates as a latitude, a longitude and their accuracy, or remove them.");
  const { latitude, longitude, accuracy } = value as Record<string, unknown>;
  if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) throw new Error("Enter both a latitude and a longitude, or remove the coordinates.");
  if (!degrees(latitude, 90)) throw new Error("Latitude must be a number from -90 to 90.");
  if (!degrees(longitude, 180)) throw new Error("Longitude must be a number from -180 to 180.");
  if (!COORDINATE_ACCURACIES.includes(accuracy as CoordinatesAccuracy)) throw new Error("Choose whether the coordinates are exact or approximate.");
  // Adding 0 saves -0 as 0, which SQLite reads back.
  return { latitude: latitude + 0, longitude: longitude + 0, accuracy: accuracy as CoordinatesAccuracy };
}

/** Coordinates as an editor's fields hold them. A blank latitude or longitude is no number, rather than 0. */
export function enteredCoordinates(latitude: string, longitude: string, accuracy: string): Coordinates {
  const degrees = (text: string) => text.trim() === "" ? NaN : Number(text);
  return { latitude: degrees(latitude), longitude: degrees(longitude), accuracy: accuracy as CoordinatesAccuracy };
}

/**
 * The coordinates a place's editor saves, from its form's fields: undefined, to keep the saved ones, when they are
 * unchanged and not confirmed, so they wait to be reviewed if the address changed; null once both degrees are cleared;
 * or what was entered, which the save confirms for the address it saves.
 */
export function coordinatesFromForm(fields: FormData, saved: SavedCoordinates | null): Coordinates | null | undefined {
  const text = (name: string) => String(fields.get(name) ?? "").trim();
  const latitude = text("latitude"), longitude = text("longitude");
  if (!latitude && !longitude) return saved ? null : undefined;
  const entered = enteredCoordinates(latitude, longitude, text("accuracy"));
  return saved && !fields.has("coordinatesConfirmed") && sameCoordinates(saved, entered) ? undefined : entered;
}

/** Whether two coordinates are the same place and accuracy. */
export function sameCoordinates(a: Coordinates, b: Coordinates): boolean {
  return a.latitude === b.latitude && a.longitude === b.longitude && a.accuracy === b.accuracy;
}

/** Coordinates as people read them, latitude first, as a map search takes them: 48.20849, 16.37208. */
export function formatCoordinates({ latitude, longitude }: Coordinates): string {
  return latitude + ", " + longitude;
}
