"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { thumbnailUrl } from "@/components/destination-gallery";
import { transportationLabel } from "@/components/transportation-icons";
import { MarkerSymbol, TransportationBadge } from "@/components/trip-map-symbols";
import { objectPosition } from "@/lib/photo-focus";
import { transportationIcons } from "@/lib/transportation-methods";
import { placeRole, previewPosition, type MapLayout, type MapMarker, type Position } from "@/lib/trip-map";
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
// How long a destination's preview stays once the pointer leaves its marker and the preview, so the pointer can cross
// between the two (TRA-143).
const PREVIEW_CLOSE_DELAY = 200;

/** The destination marker whose preview the pointer is over, on the marker or the preview, and whether it has left both. */
interface Hover { key: string; leaving: boolean }
const leave = (hover: Hover | null): Hover | null => hover && { key: hover.key, leaving: true };

/**
 * A trip's journey on an OpenStreetMap map (TRA-44): Leaflet places each marker, and React draws what is in it. The map
 * frames every place when it opens and whenever the places change, and leaves zoom and panning alone otherwise.
 * Selecting a marker, by pointer, touch, Enter or Space, goes to what it stands for on the trip page. Markers are drawn
 * before the page paints, so what React renders into them never shows without them.
 *
 * A destination's marker shows a preview of it (TRA-143), its name and primary photo, while a mouse or pen is over the
 * marker or the preview, and while the keyboard is on the marker. It closes a moment after the pointer leaves both, when
 * the keyboard moves on, or on Escape. Touch has no hover, so a tap goes to the destination as before, without one.
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
  const [hovered, setHovered] = useState<Hover | null>(null);
  // The destination marker the keyboard is on.
  const [focused, setFocused] = useState<string | null>(null);
  // Whether the map is moving, as when Leaflet brings a marker the keyboard reaches into view. The preview waits until it
  // stops, then shows beside its marker where the marker ends up.
  const [moving, setMoving] = useState(false);
  const preview = useRef<HTMLDivElement>(null);
  const shown = hovered?.key ?? focused;
  const previewed = moving ? undefined : layout.markers.find((marker) => marker.key === shown);

  useLayoutEffect(() => {
    const instance = L.map(container.current!, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(instance);
    // The mouse wheel zooms only once the map is selected, so scrolling the page past it scrolls the page.
    instance.on("focus", () => instance.scrollWheelZoom.enable());
    instance.on("blur", () => instance.scrollWheelZoom.disable());
    instance.on("movestart zoomstart", () => setMoving(true));
    instance.on("moveend", () => setMoving(false));
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
      return element;
    };
    // The keyboard reaches places in travel order, then each connection's transportation.
    for (const marker of layout.markers) {
      const label = placeRole(marker.kind, marker.number) + ": " + marker.label;
      const element = place(marker.key, marker.position, [size[marker.kind], size[marker.kind]], label, label + "\nShown at " + marker.found, marker.target, zIndex[marker.kind]);
      // Only a destination's marker has a preview. The marker's label already names the destination for screen readers,
      // so the preview, which repeats it, is hidden from them.
      if (!element || marker.kind !== "destination") continue;
      element.addEventListener("pointerenter", (event) => { if (event.pointerType !== "touch") setHovered({ key: marker.key, leaving: false }); });
      // React tells the preview the pointer has reached it before the marker hears it has left, so leaving the marker
      // straight for the preview leaves it open.
      element.addEventListener("pointerleave", (event) => { if (!preview.current?.contains(event.relatedTarget as Node | null)) setHovered(leave); });
      // Only the keyboard's focus shows it: a click or tap focuses the marker too, on its way to the destination.
      element.addEventListener("focus", () => { if (element.matches(":focus-visible")) setFocused(marker.key); });
      element.addEventListener("blur", () => setFocused(null));
    }
    for (const line of layout.lines) {
      const label = transportationLabel(line.method) + " from " + line.from + " to " + line.to;
      place("line-" + line.id, line.badge, badgeSize(line.method), label, label, line.target, 0);
    }
  }, [layout, elements]);

  useEffect(() => {
    if (!hovered?.leaving) return;
    const timer = setTimeout(() => setHovered(null), PREVIEW_CLOSE_DELAY);
    return () => clearTimeout(timer);
  }, [hovered]);

  // Escape closes the preview without moving the pointer or the keyboard. It shows again once either comes back.
  useEffect(() => {
    if (shown === null) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setHovered(null);
      setFocused(null);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [shown]);

  // The preview goes beside its marker wherever the map has room for all of it, once its size is known and before it shows.
  useLayoutEffect(() => {
    const instance = map.current, element = preview.current;
    if (!instance || !element || !previewed) return;
    const area = instance.getSize();
    const corner = previewPosition(instance.latLngToContainerPoint(previewed.position), { width: element.offsetWidth, height: element.offsetHeight }, { width: area.x, height: area.y }, size[previewed.kind] / 2);
    element.style.left = corner.x + "px";
    element.style.top = corner.y + "px";
  }, [previewed]);

  return <>
    <div ref={container} className={styles.map} />
    {layout.markers.map((marker) => createPortal(<MarkerSymbol kind={marker.kind} number={marker.number} />, elements.get(marker.key)!, marker.key))}
    {layout.lines.map((line) => createPortal(<TransportationBadge method={line.method} />, elements.get("line-" + line.id)!, "line-" + line.id))}
    {previewed && <div key={previewed.key} ref={preview} className={styles.preview} aria-hidden="true" onPointerEnter={() => setHovered({ key: previewed.key, leaving: false })} onPointerLeave={() => setHovered(leave)}>
      {/* Stored photos are resized and optimized on upload, and the thumbnail covers the preview's frame. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {previewed.photo && <img className={styles.previewPhoto} src={thumbnailUrl(previewed.photo.destinationId, previewed.photo)} alt="" decoding="async" style={{ objectPosition: objectPosition(previewed.photo) }} />}
      <strong className={styles.previewName}>{previewed.label}</strong>
    </div>}
  </>;
}
