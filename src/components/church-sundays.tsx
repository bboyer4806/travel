import { churchSundayDates } from "@/lib/trip-dates";
import styles from "./church-sundays.module.css";

const sundayDateFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
});

export function ChurchSundays({ destination }: {
  destination: { arrivalDate: string | null; departureDate: string | null };
}) {
  const sundays = churchSundayDates(destination);
  return <section className={styles.panel} aria-label="Sundays during your stay">
    <h3>Sundays during your stay</h3>
    {sundays === null ? <p>Sunday dates will appear once this destination&apos;s dates can be calculated.</p>
      : sundays.length ? <ul>{sundays.map((date) => <li key={date}>
        <time dateTime={date}>{sundayDateFormat.format(new Date(date + "T00:00:00.000Z"))}</time>
      </li>)}</ul>
        : <p>No Sundays fall within this stay.</p>}
    <p className="helper">These dates are based on your stay. Mass times are not verified; confirm them with the church before your visit.</p>
  </section>;
}
