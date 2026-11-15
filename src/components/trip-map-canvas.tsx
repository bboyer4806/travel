"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { transportationLabel } from "@/components/transportation-icons";
import { MarkerSymbol, TransportationBadge } from "@/components/trip-map-symbols";
import { transportationIcons } from "@/lib/transportation-methods";
import { placeRole, type MapLayout, type MapMarker, type Position } from "@/lib/trip-map";
import styles from "./trip-map.module.css";

/** Scrolls to what a marker stands for on the trip page and focuses it, so the keyboard carries on from there. */
function showOnPage(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  target.focus({ preventScroll: true });
}

const zIndex: Record<MapMarker["kind"], number> = { roundTrip: 3000, departure: 3000, return: 3000, destination: 2000, layover: 1000, stop: 1000 };
// Each marker's size, so what it draws can be selected and outlined whole: trip endpoints and destinations are larger
// than layovers and stops, and a connection's transportation is as wide as its icons.
const size: Record<MapMarker["kind"], number> = { roundTrip: 30, departure: 30, return: 30, destination: 30, layover: 22, stop: 22 };
const badgeSize = (method: string): [number, number] => [12 + 17 * transportationIcons(method).length, 22];

/**
 * A trip's journey on an OpenStreetMap map (TRA-44): Leaflet places each marker, and React draws what is in it. The map
 * frames every place when it opens and whenever the places change, and leaves zoom and panning alone otherwise.
 * Selecting a marker, by pointer, touch, Enter or Space, goes to what it stands for on the trip page. Markers are drawn
 * before the page paints, so what React renders into them never shows without them.
 */
export default function TripMapCanvas({ layout }: { layout: MapLayout }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  // The positions the map last framed.
  const framed = useRef("");
  // An element for each marker's content, which Leaflet places on the map and React renders into.
  const elements = useMemo(() => new Map([...layout.markers.map((marker) => marker.key), ...layout.lines.map((line) => "line-" + line.id)].map((key) => {
    const element = document.createElement("span");
    element.className = styles.content;
    return [key, element];
  })), [layout]);

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
    const positions = layout.markers.map((marker) => marker.position);
    const frame = JSON.stringify([...positions].sort());
    if (frame !== framed.current) {
      instance.fitBounds(L.latLngBounds(positions), { padding: [36, 36], maxZoom: 11, animate: false });
      framed.current = frame;
    }
    group.clearLayers();
    for (const line of layout.lines) L.polyline(line.points, { color: "#254f42", weight: 3, opacity: 0.7, interactive: false }).addTo(group);
    const place = (key: string, position: Position, iconSize: [number, number], label: string, title: string, target: string | null, zIndexOffset: number) => {
      const icon = L.divIcon({ className: styles.anchor, html: elements.get(key)!, iconSize });
      const marker = L.marker(position, { icon, title, zIndexOffset, keyboard: target !== null, interactive: target !== null }).addTo(group);
      const element = marker.getElement();
      if (!element || target === null) return;
      element.setAttribute("aria-label", label);
      marker.on("click", () => showOnPage(target));
      marker.on("keydown", (event) => {
        const { originalEvent } = event as L.LeafletKeyboardEvent;
        if (originalEvent.key !== "Enter" && originalEvent.key !== " ") return;
        originalEvent.preventDefault();
        showOnPage(target);
      });
    };
    // The keyboard reaches places in travel order, then each connection's transportation.
    for (const marker of layout.markers) {
      const label = placeRole(marker.kind, marker.number) + ": " + marker.label;
      place(marker.key, marker.position, [size[marker.kind], size[marker.kind]], label, label + "\nShown at " + marker.found, marker.target, zIndex[marker.kind]);
    }
    for (const line of layout.lines) {
      const label = transportationLabel(line.method) + " from " + line.from + " to " + line.to;
      place("line-" + line.id, line.badge, badgeSize(line.method), label, label, line.target, 0);
    }
  }, [layout, elements]);

  return <>
    <div ref={container} className={styles.map} />
    {layout.markers.map((marker) => createPortal(<MarkerSymbol kind={marker.kind} number={marker.number} />, elements.get(marker.key)!, marker.key))}
    {layout.lines.map((line) => createPortal(<TransportationBadge method={line.method} />, elements.get("line-" + line.id)!, "line-" + line.id))}
  </>;
}
