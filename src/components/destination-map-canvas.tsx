"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { MAP_PLACE_LABELS, type DestinationMarker, type MappedPlace } from "@/lib/destination-map";
import { GroupSymbol, PlaceSymbol } from "./destination-map-symbols";
import styles from "./destination-map.module.css";

// How close the map frames a single place, with the streets around it in view.
const MAX_ZOOM = 16;
const SIZE = 30;

/**
 * Where a marker's tooltip says a place is: the address OpenStreetMap has where it was found, or its saved coordinates,
 * which never name an address, so approximate ones aren't taken for a verified one (TRA-150).
 */
function shownAt(place: MappedPlace): string {
  return place.found !== null ? "Shown at " + place.found : place.approximate ? "Shown at its approximate coordinates" : "Shown at its saved coordinates";
}

function element(tag: "span" | "div", className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/**
 * A destination's saved places on an OpenStreetMap map (TRA-130): Leaflet places each marker and its popup, and React
 * draws what is in them. The map frames every marker when it opens and whenever their positions change, and leaves zoom
 * and panning alone otherwise, so a place saved far from its destination is in view too (TRA-150). Selecting a marker,
 * by pointer, touch, Enter or Space, opens its popup: the name and category of each place there, whether it is shown at
 * approximate coordinates, and View details. The popup takes focus as it opens, and Escape closes it and returns focus
 * to its marker.
 */
export default function DestinationMapCanvas({ markers, onView }: { markers: DestinationMarker[]; onView: (place: MappedPlace) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  // The positions the map last framed.
  const framed = useRef("");
  // Each marker's symbol and popup, which Leaflet places on the map and React renders into.
  const elements = useMemo(() => new Map(markers.map((marker) => [marker.key, { symbol: element("span", styles.content), popup: element("div", styles.popup) }])), [markers]);

  useLayoutEffect(() => {
    const instance = L.map(container.current!, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(instance);
    // The mouse wheel zooms only once the map is selected, so scrolling the page past it scrolls the page.
    instance.on("focus", () => instance.scrollWheelZoom.enable());
    instance.on("blur", () => instance.scrollWheelZoom.disable());
    layers.current = L.layerGroup().addTo(instance);
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
      layers.current = null;
      framed.current = "";
    };
  }, []);

  useLayoutEffect(() => {
    const instance = map.current, group = layers.current;
    if (!instance || !group) return;
    const positions = markers.map((marker) => marker.position);
    const frame = JSON.stringify([...positions].sort());
    if (frame !== framed.current) {
      instance.fitBounds(L.latLngBounds(positions), { padding: [36, 36], maxZoom: MAX_ZOOM, animate: false });
      framed.current = frame;
    }
    group.clearLayers();
    const closers: (() => void)[] = [];
    for (const marker of markers) {
      const { symbol, popup } = elements.get(marker.key)!;
      const names = marker.places.map((place) => MAP_PLACE_LABELS[place.category] + ": " + place.name + (place.approximate ? " (approximate location)" : ""));
      const item = L.marker(marker.position, {
        icon: L.divIcon({ className: styles.anchor, html: symbol, iconSize: [SIZE, SIZE] }),
        title: marker.places.map((place, index) => names[index] + "\n" + shownAt(place)).join("\n"),
        keyboard: true,
      }).bindPopup(popup, { maxWidth: 280, autoPanPadding: [16, 16] }).addTo(group);
      const target = item.getElement()!;
      target.setAttribute("aria-label", names.join("; "));
      // Leaflet opens a marker's popup on Enter, and Space, as for any button, opens it too.
      item.on("keydown", (event) => {
        const { originalEvent } = event as L.LeafletKeyboardEvent;
        if (originalEvent.key !== " ") return;
        originalEvent.preventDefault();
        item.openPopup();
      });
      // Focus moves without scrolling, which would shift Leaflet's panes within the map.
      item.on("popupopen", () => popup.querySelector("button")?.focus({ preventScroll: true }));
      item.on("popupclose", () => {
        const active = document.activeElement;
        if (active === document.body || item.getPopup()?.getElement()?.contains(active)) target.focus({ preventScroll: true });
      });
      // Leaflet closes a popup on Escape only while the map itself has focus.
      const close = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        item.closePopup();
      };
      popup.addEventListener("keydown", close);
      closers.push(() => popup.removeEventListener("keydown", close));
    }
    return () => { for (const remove of closers) remove(); };
  }, [markers, elements]);

  return <>
    <div ref={container} className={styles.map} />
    {markers.map((marker) => createPortal(marker.places.length === 1 ? <PlaceSymbol category={marker.places[0].category} approximate={marker.places[0].approximate} />
      : <GroupSymbol count={marker.places.length} approximate={marker.places.every((place) => place.approximate)} />, elements.get(marker.key)!.symbol, "symbol-" + marker.key))}
    {markers.map((marker) => createPortal(<ul className={styles.popupPlaces}>
      {marker.places.map((place) => <li key={place.id}>
        <strong>{place.name}</strong>
        <span className={styles.category}>{MAP_PLACE_LABELS[place.category]}{place.approximate && " · Approximate location"}</span>
        <button type="button" className="text-button" onClick={() => onView(place)}>View details<span className="sr-only"> for {place.name}</span></button>
      </li>)}
    </ul>, elements.get(marker.key)!.popup, "popup-" + marker.key))}
  </>;
}
