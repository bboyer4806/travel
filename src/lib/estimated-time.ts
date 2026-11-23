/** A count with its unit, singular for one: "1 hour", "2 hours". */
function unit(count: number, name: string): string {
  return `${count} ${name}${count === 1 ? "" : "s"}`;
}

/**
 * An activity's estimated time as people read it (TRA-170), in hours and minutes however long it is: "45 minutes",
 * "1 hour", "1 hour 30 minutes" or "25 hours 30 minutes". Travel saves it in whole minutes from 1.
 */
export function formatEstimatedTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return unit(rest, "minute");
  return rest === 0 ? unit(hours, "hour") : `${unit(hours, "hour")} ${unit(rest, "minute")}`;
}
