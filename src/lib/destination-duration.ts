const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const timestamp = Date.parse(value + "T00:00:00.000Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

// Calendar dates use UTC midnight so local time zones and daylight saving cannot alter the count.
export function stayNights(arrivalDate: string | null | undefined, departureDate: string | null | undefined): number | null {
  if (!arrivalDate || !departureDate || !isValidDate(arrivalDate) || !isValidDate(departureDate)) return null;
  const days = (Date.parse(departureDate + "T00:00:00.000Z") - Date.parse(arrivalDate + "T00:00:00.000Z")) / MILLISECONDS_PER_DAY;
  return days < 0 ? null : days;
}

export function budgetDays(arrivalDate: string | null | undefined, departureDate: string | null | undefined): number | null {
  const nights = stayNights(arrivalDate, departureDate);
  return nights === 0 ? 0.5 : nights;
}

// Include both arrival and departure days, without local-time or DST shifts.
export function containsSunday(arrivalDate: string | null | undefined, departureDate: string | null | undefined): boolean {
  const nights = stayNights(arrivalDate, departureDate);
  if (nights === null) return false;
  const arrivalDay = new Date(arrivalDate + "T00:00:00.000Z").getUTCDay();
  const daysUntilSunday = (7 - arrivalDay) % 7;
  return nights >= daysUntilSunday;
}
