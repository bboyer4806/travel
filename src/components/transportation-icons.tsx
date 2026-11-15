import { Bike, Bus, Car, Footprints, Plane, Route, Ship, TrainFront, type LucideIcon } from "lucide-react";
import { transportationIcons, type TransportationIcon } from "@/lib/transportation-methods";

const transportation: Record<TransportationIcon, { Icon: LucideIcon; label: string }> = {
  airplane: { Icon: Plane, label: "Airplane" },
  train: { Icon: TrainFront, label: "Train" },
  car: { Icon: Car, label: "Car" },
  bus: { Icon: Bus, label: "Bus" },
  boat: { Icon: Ship, label: "Boat" },
  walking: { Icon: Footprints, label: "Walking" },
  bicycle: { Icon: Bike, label: "Bicycle" },
  route: { Icon: Route, label: "Unknown transportation" },
};

/** The kinds of transportation a connection's saved text names, as its icons are labeled, such as "Train, Airplane". */
export function transportationLabel(method: string): string {
  return transportationIcons(method).map((icon) => transportation[icon].label).join(", ");
}

/** A connection's icons: one for each kind of transportation its saved text names, in the order entered. */
export function TransportationIcons({ method, size = 16, className = "route-dot" }: { method: string; size?: number; className?: string }) {
  return <span className={className} role="img" aria-label={transportationLabel(method)}>
    {transportationIcons(method).map((icon) => { const { Icon } = transportation[icon]; return <Icon key={icon} size={size} aria-hidden="true" />; })}</span>;
}
