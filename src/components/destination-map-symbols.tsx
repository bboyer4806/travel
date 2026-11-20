import { BedDouble, Binoculars, Church, Utensils } from "lucide-react";
import type { MapCategory } from "@/lib/destination-map";
import styles from "./destination-map.module.css";

const icons = { hotels: BedDouble, activities: Binoculars, restaurants: Utensils, churches: Church };

/** A symbol's classes: approximate coordinates draw a dashed ring around it (TRA-150). */
function symbolClass(kind: string, approximate: boolean): string {
  return styles.symbol + " " + kind + (approximate ? " " + styles.approximate : "");
}

/**
 * How a destination's map draws a place of each category (TRA-130): its icon on its own color, in a dashed ring when it
 * is shown at approximate coordinates (TRA-150). Its checkbox shows the same.
 */
export function PlaceSymbol({ category, approximate = false }: { category: MapCategory; approximate?: boolean }) {
  const Icon = icons[category];
  return <span className={symbolClass(styles[category], approximate)}><Icon size={15} strokeWidth={2.2} aria-hidden="true" /></span>;
}

/** Places at one position, drawn as how many there are, in a dashed ring when every one is shown at approximate coordinates. */
export function GroupSymbol({ count, approximate = false }: { count: number; approximate?: boolean }) {
  return <span className={symbolClass(styles.group, approximate)}>{count}</span>;
}
