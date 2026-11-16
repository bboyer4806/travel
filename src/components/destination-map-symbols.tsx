import { BedDouble, Binoculars, Church, Utensils } from "lucide-react";
import type { MapCategory } from "@/lib/destination-map";
import styles from "./destination-map.module.css";

const icons = { hotels: BedDouble, activities: Binoculars, restaurants: Utensils, churches: Church };

/** How a destination's map draws a place of each category (TRA-130): its icon on its own color. Its checkbox shows the same. */
export function PlaceSymbol({ category }: { category: MapCategory }) {
  const Icon = icons[category];
  return <span className={styles.symbol + " " + styles[category]}><Icon size={15} strokeWidth={2.2} aria-hidden="true" /></span>;
}

/** Places found at one position, drawn as how many there are. */
export function GroupSymbol({ count }: { count: number }) {
  return <span className={styles.symbol + " " + styles.group}>{count}</span>;
}
