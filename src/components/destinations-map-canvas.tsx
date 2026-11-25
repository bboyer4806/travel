"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin } from "lucide-react";
import { destinationHref, markersAt, type DestinationsMarker, type MappedDestination } from "@/lib/destinations-map";
import styles from "./destinations-map.module.css";

// How close the map frames a single destination, as a trip's map frames its places (TRA-44).
const MAX_ZOOM = 11;
const SIZE = 30;
// How far an opening popup keeps from the map's edges, and how much of a popup surrounds its content: Leaflet's margins
// above and below it (13 px each), the padding around them (1 px each) and its tip (20 px).
const PAN_PADDING = 16;
const POPUP_FRAME = 48;

function element(tag: "span" | "div", className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/**
 * Every saved destination the Destinations page shows, on an OpenStreetMap map (TRA-180): Leaflet places each marker and
 * popup, and React draws what is in them. The map frames every destination when it opens and whenever their positions
 * change, as when the search changes, and leaves zoom and panning alone otherwise. Selecting a destination's marker, by
 * pointer, touch, Enter or Space, opens the destination's page. Destinations whose markers would cover each other at the
 * map's zoom share one, showing how many there are, which opens a popup instead, with a link to each one's page; the
 * popup takes focus as it opens, and Escape closes it and returns focus to its marker. Zooming in sets them apart.
 */
export default function DestinationsMapCanvas({ destinations }: { destinations: MappedDestination[] }) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  // The positions the map last framed.
  const framed = useRef("");
  // The map's zoom, once it has one, which decides which destinations share a marker.
  const [zoom, setZoom] = useState<number | null>(null);
  // The markers keep their identity while the same destinations share them, so zooming draws them again only when that changes.
  const markersJson = JSON.stringify(zoom === null ? [] : markersAt(destinations, (position) => L.CRS.EPSG3857.latLngToPoint(L.latLng(position), zoom), SIZE));
  const markers = useMemo(() => JSON.parse(markersJson) as DestinationsMarker[], [markersJson]);
  // Each marker's symbol, and the popup of one that destinations share, which Leaflet places and React renders into.
  const elements = useMemo(() => new Map(markers.map((marker) => [marker.key, { symbol: element("span", styles.content), popup: element("div", "") }])), [markers]);

  useLayoutEffect(() => {
    const instance = L.map(container.current!, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(instance);
    // The mouse wheel zooms only once the map is selected, so scrolling the page past it scrolls the page.
    instance.on("focus", () => instance.scrollWheelZoom.enable());
    instance.on("blur", () => instance.scrollWheelZoom.disable());
    instance.on("zoomend", () => setZoom(instance.getZoom()));
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
    const instance = map.current;
    if (!instance) return;
    const positions = destinations.map((destination) => destination.position);
    const frame = JSON.stringify([...positions].sort());
    if (frame === framed.current) return;
    instance.fitBounds(L.latLngBounds(positions), { padding: [36, 36], maxZoom: MAX_ZOOM, animate: false });
    framed.current = frame;
    setZoom(instance.getZoom());
  }, [destinations]);

  useLayoutEffect(() => {
    const instance = map.current, group = layers.current;
    if (!instance || !group) return;
    group.clearLayers();
    const closers: (() => void)[] = [];
    const maxHeight = instance.getSize().y - POPUP_FRAME - 2 * PAN_PADDING;
    for (const marker of markers) {
      const { symbol, popup } = elements.get(marker.key)!;
      const names = marker.destinations.map((item) => item.name);
      const [only] = marker.destinations;
      const item = L.marker(marker.position, {
        icon: L.divIcon({ className: styles.anchor, html: symbol, iconSize: [SIZE, SIZE] }),
        // A destination's tooltip names the place the map found for it, and a shared marker's names its destinations.
        title: names.length === 1 ? only.name + "\nShown at " + only.found : names.join("\n"),
        keyboard: true,
      }).addTo(group);
      const target = item.getElement()!;
      if (names.length === 1) {
        target.setAttribute("aria-label", only.name);
        const open = () => router.push(destinationHref(only.id));
        item.on("click", open);
        item.on("keydown", (event) => {
          const { originalEvent } = event as L.LeafletKeyboardEvent;
          if (originalEvent.key !== "Enter" && originalEvent.key !== " ") return;
          originalEvent.preventDefault();
          open();
        });
        continue;
      }
      target.setAttribute("aria-label", names.length + " destinations: " + names.join("; "));
      item.bindPopup(popup, { maxWidth: 280, maxHeight, autoPanPadding: [PAN_PADDING, PAN_PADDING] });
      // Leaflet opens a marker's popup on a click, a tap or Enter, and Space, as for any button, opens it too.
      item.on("keydown", (event) => {
        const { originalEvent } = event as L.LeafletKeyboardEvent;
        if (originalEvent.key !== " ") return;
        originalEvent.preventDefault();
        item.openPopup();
      });
      // Leaflet measures a popup's width before it knows the popup scrolls, so a popup that scrolls is measured again.
      // Then focus moves to its first destination without scrolling, which would shift Leaflet's panes within the map.
      item.on("popupopen", () => {
        const opened = item.getPopup()!;
        if (opened.getElement()!.querySelector(".leaflet-popup-scrolled")) opened.update();
        popup.querySelector("a")?.focus({ preventScroll: true });
      });
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
  }, [markers, elements, router]);

  return <>
    <div ref={container} className={styles.map} />
    {markers.map((marker) => createPortal(marker.destinations.length === 1
      ? <span className={styles.symbol}><MapPin size={15} strokeWidth={2.2} aria-hidden="true" /></span>
      : <span className={styles.symbol + " " + styles.group}>{marker.destinations.length}</span>, elements.get(marker.key)!.symbol, "symbol-" + marker.key))}
    {/* Each destination sharing a marker, named as its card names it, linking to its page. */}
    {markers.filter((marker) => marker.destinations.length > 1).map((marker) => createPortal(<ul className={styles.popupList} aria-label={marker.destinations.length + " destinations here"}>
      {marker.destinations.map((destination) => <li key={destination.id}><Link href={destinationHref(destination.id)}>{destination.name}</Link></li>)}
    </ul>, elements.get(marker.key)!.popup, "popup-" + marker.key))}
  </>;
}
