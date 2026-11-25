"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight } from "lucide-react";
import { thumbnailUrl } from "@/components/destination-gallery";
import { TransportationIcons, transportationLabel } from "@/components/transportation-icons";
import { MarkerSymbol, TransportationBadge } from "@/components/trip-map-symbols";
import { objectPosition } from "@/lib/photo-focus";
import { transportationIcons } from "@/lib/transportation-methods";
import { placeRole, popupPosition, previewPosition, type MapLayout, type MapMarker, type Position } from "@/lib/trip-map";
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
const BADGE_HEIGHT = 22;
const badgeSize = (method: string): [number, number] => [12 + 17 * transportationIcons(method).length, BADGE_HEIGHT];
// A connection's arrows (TRA-176) are the same size at every zoom, and below every place and transportation, which Leaflet
// stacks by these offsets, so an arrow never covers one.
const ARROW_SIZE = 16;
const ARROW_Z_INDEX = -1000;
/** What Leaflet places for connection `id`'s arrow `index`, its arrows in the order of its lines. */
const arrowKey = (id: string, index: number) => "arrow-" + id + "-" + index;
// How long a destination's preview, or a connection's popup opened by pointing to it, stays once the pointer leaves its
// marker and the preview or popup, so the pointer can cross between the two (TRA-143, TRA-175).
const PREVIEW_CLOSE_DELAY = 200;

/** The destination marker whose preview the pointer is over, on the marker or the preview, and whether it has left both. */
interface Hover { key: string; leaving: boolean }
const leave = (hover: Hover | null): Hover | null => hover && { key: hover.key, leaving: true };

/**
 * The connection whose popup shows (TRA-175): opened by pointing to its transportation, until a moment after the pointer
 * has left both its transportation and the popup, or `selected`, by a click, tap, Enter or Space, until it is dismissed.
 */
interface Opened { id: string; selected: boolean; leaving: boolean }
/** The popup once the pointer leaves connection `id`'s transportation or popup: one opened by pointing closes a moment later. */
const leaveConnection = (opened: Opened | null, id: string): Opened | null => opened?.id === id && !opened.selected ? { ...opened, leaving: true } : opened;

/**
 * A trip's journey on an OpenStreetMap map (TRA-44): Leaflet places each marker, and React draws what is in it. The map
 * frames every place when it opens and whenever the places change, and leaves zoom and panning alone otherwise.
 * Selecting a place's marker, by pointer, touch, Enter or Space, goes to what it stands for on the trip page. Markers are
 * drawn before the page paints, so what React renders into them never shows without them. Arrows on each connection's
 * lines show the way it goes (TRA-176), below its places and transportation, and nothing selects them.
 *
 * A destination's marker shows a preview of it (TRA-143), its name and primary photo, while a mouse or pen is over the
 * marker or the preview, and while the keyboard is on the marker. It closes a moment after the pointer leaves both, when
 * the keyboard moves on, or on Escape. Touch has no hover, so a tap goes to the destination as before, without one.
 *
 * A connection's transportation opens a popup of the connection (TRA-175): its route and saved details, and View
 * details, which goes to its card on the trip page. Pointing to the transportation with a mouse or pen opens it until a
 * moment after the pointer leaves both, and selecting it, by pointer, touch, Enter or Space, opens it and moves focus to
 * View details, until a click or tap elsewhere on the map, Escape, which returns focus to the transportation, or another
 * connection's popup closes it. One connection's popup shows at a time, apart from destinations' previews.
 */
export default function TripMapCanvas({ layout }: { layout: MapLayout }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  // The positions the map last framed.
  const framed = useRef("");
  // An element for each marker's content, which Leaflet places on the map and React renders into.
  const elements = useMemo(() => new Map([
    ...layout.markers.map((marker) => marker.key),
    ...layout.lines.map((line) => "line-" + line.id),
    ...layout.lines.flatMap((line) => line.arrows.map((_arrow, index) => arrowKey(line.id, index))),
  ].map((key) => {
    const element = document.createElement("span");
    element.className = styles.content;
    return [key, element];
  })), [layout]);
  const [hovered, setHovered] = useState<Hover | null>(null);
  // The destination marker the keyboard is on.
  const [focused, setFocused] = useState<string | null>(null);
  // Whether the map is moving, as when Leaflet brings a marker the keyboard reaches into view. The preview and the popup
  // wait until it stops, then show beside their marker where the marker ends up.
  const [moving, setMoving] = useState(false);
  const preview = useRef<HTMLDivElement>(null);
  const shown = hovered?.key ?? focused;
  const previewed = moving ? undefined : layout.markers.find((marker) => marker.key === shown);
  const [opened, setOpened] = useState<Opened | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  // Each connection's transportation, by the connection's ID, which Escape returns focus to from its popup.
  const badges = useRef(new Map<string, HTMLElement>());
  // Whether the popup takes focus once it shows, as it does when selected, so the keyboard and screen readers reach it.
  const focusPopup = useRef(false);
  const popupId = useId();
  const openedId = opened?.id ?? null;
  const connection = moving ? undefined : layout.lines.find((line) => line.id === openedId);

  useLayoutEffect(() => {
    const instance = L.map(container.current!, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(instance);
    // The mouse wheel zooms only once the map is selected, so scrolling the page past it scrolls the page.
    instance.on("focus", () => instance.scrollWheelZoom.enable());
    instance.on("blur", () => instance.scrollWheelZoom.disable());
    instance.on("movestart zoomstart", () => setMoving(true));
    instance.on("moveend", () => setMoving(false));
    // A click or tap anywhere on the map closes a connection's popup, before one on a connection's transportation opens
    // its own. Dragging the map, its zoom buttons and its credits leave it open.
    instance.on("preclick", () => setOpened(null));
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
    badges.current.clear();
    for (const line of layout.lines) L.polyline(line.points, { color: "#254f42", weight: 3, opacity: 0.7, interactive: false }).addTo(group);
    const place = (key: string, position: Position, iconSize: [number, number], label: string, title: string, select: (() => void) | null, zIndexOffset: number) => {
      const icon = L.divIcon({ className: styles.anchor, html: elements.get(key)!, iconSize });
      const marker = L.marker(position, { icon, title, zIndexOffset, keyboard: select !== null, interactive: select !== null }).addTo(group);
      const element = marker.getElement();
      if (!element || select === null) return;
      element.setAttribute("aria-label", label);
      marker.on("click", select);
      marker.on("keydown", (event) => {
        const { originalEvent } = event as L.LeafletKeyboardEvent;
        if (originalEvent.key !== "Enter" && originalEvent.key !== " ") return;
        originalEvent.preventDefault();
        select();
      });
      return element;
    };
    // Each connection's arrows show the way it goes along its lines (TRA-176), and Leaflet keeps them on their lines as the
    // map zooms and moves. They are only drawn, below every place and transportation, so clicks, taps and the keyboard
    // pass them by.
    for (const line of layout.lines) line.arrows.forEach((arrow, index) => place(arrowKey(line.id, index), arrow.position, [ARROW_SIZE, ARROW_SIZE], "", "", null, ARROW_Z_INDEX));
    // The keyboard reaches places in travel order, then each connection's transportation.
    for (const marker of layout.markers) {
      const label = placeRole(marker.kind, marker.number) + ": " + marker.label;
      const target = marker.target;
      const element = place(marker.key, marker.position, [size[marker.kind], size[marker.kind]], label, label + "\nShown at " + marker.found, target === null ? null : () => showOnPage(target), zIndex[marker.kind]);
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
      // Selecting it opens its popup and moves focus there. Its popup shows more than a tooltip could, so it has none.
      const element = place("line-" + line.id, line.badge, badgeSize(line.method), label, "", () => {
        focusPopup.current = true;
        setOpened({ id: line.id, selected: true, leaving: false });
      }, 0);
      if (!element) continue;
      element.setAttribute("aria-haspopup", "dialog");
      badges.current.set(line.id, element);
      // Touch has no hover: a tap selects it.
      element.addEventListener("pointerenter", (event) => {
        if (event.pointerType !== "touch") setOpened((current) => current?.id !== line.id ? { id: line.id, selected: false, leaving: false } : current.leaving ? { ...current, leaving: false } : current);
      });
      element.addEventListener("pointerleave", (event) => { if (!popup.current?.contains(event.relatedTarget as Node | null)) setOpened((current) => leaveConnection(current, line.id)); });
    }
  }, [layout, elements]);

  // Each connection's transportation tells screen readers whether its popup is open.
  useLayoutEffect(() => {
    for (const [id, element] of badges.current) element.setAttribute("aria-expanded", String(id === openedId));
  }, [openedId, layout, elements]);

  useEffect(() => {
    if (!hovered?.leaving) return;
    const timer = setTimeout(() => setHovered(null), PREVIEW_CLOSE_DELAY);
    return () => clearTimeout(timer);
  }, [hovered]);

  useEffect(() => {
    if (!opened?.leaving) return;
    const timer = setTimeout(() => setOpened(null), PREVIEW_CLOSE_DELAY);
    return () => clearTimeout(timer);
  }, [opened]);

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

  // Escape closes a connection's popup, and focus in the popup returns to the connection's transportation.
  useEffect(() => {
    if (openedId === null) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (popup.current?.contains(document.activeElement)) badges.current.get(openedId)?.focus({ preventScroll: true });
      setOpened(null);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [openedId]);

  // The preview goes beside its marker wherever the map has room for all of it, once its size is known and before it shows.
  useLayoutEffect(() => {
    const instance = map.current, element = preview.current;
    if (!instance || !element || !previewed) return;
    const area = instance.getSize();
    const corner = previewPosition(instance.latLngToContainerPoint(previewed.position), { width: element.offsetWidth, height: element.offsetHeight }, { width: area.x, height: area.y }, size[previewed.kind] / 2);
    element.style.left = corner.x + "px";
    element.style.top = corner.y + "px";
  }, [previewed]);

  // A connection's popup goes beside its transportation, never over it, once its size is known and before it shows, and
  // once selected, focus moves to its View details without scrolling the page.
  useLayoutEffect(() => {
    const instance = map.current, element = popup.current;
    if (!instance || !element || !connection) return;
    const area = instance.getSize();
    const [width, height] = badgeSize(connection.method);
    const corner = popupPosition(instance.latLngToContainerPoint(connection.badge), { width: element.offsetWidth, height: element.offsetHeight }, { width: area.x, height: area.y }, { width, height });
    element.style.left = corner.x + "px";
    element.style.top = corner.y + "px";
    if (!focusPopup.current) return;
    focusPopup.current = false;
    element.querySelector("button")?.focus({ preventScroll: true });
  }, [connection, opened]);

  return <>
    <div ref={container} className={styles.map} />
    {layout.markers.map((marker) => createPortal(<MarkerSymbol kind={marker.kind} number={marker.number} />, elements.get(marker.key)!, marker.key))}
    {layout.lines.map((line) => createPortal(<TransportationBadge method={line.method} />, elements.get("line-" + line.id)!, "line-" + line.id))}
    {/* An arrowhead pointing east, turned the way its line goes. Each transportation's label tells screen readers the way. */}
    {layout.lines.flatMap((line) => line.arrows.map((arrow, index) => createPortal(
      <svg className={styles.arrow} viewBox="0 0 16 16" style={{ transform: "rotate(" + arrow.angle + "deg)" }} aria-hidden="true"><path d="M14 8 2 14l3.5-6L2 2z" /></svg>,
      elements.get(arrowKey(line.id, index))!, arrowKey(line.id, index))))}
    {previewed && <div key={previewed.key} ref={preview} className={styles.preview} aria-hidden="true" onPointerEnter={() => setHovered({ key: previewed.key, leaving: false })} onPointerLeave={() => setHovered(leave)}>
      {/* Stored photos are resized and optimized on upload, and the thumbnail covers the preview's frame. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {previewed.photo && <img className={styles.previewPhoto} src={thumbnailUrl(previewed.photo.destinationId, previewed.photo)} alt="" decoding="async" style={{ objectPosition: objectPosition(previewed.photo) }} />}
      <strong className={styles.previewName}>{previewed.label}</strong>
    </div>}
    {/* A connection's popup, named by its route and described by its details. Once focus is in a popup opened by
        pointing, it stays until dismissed, so focus never goes with it. */}
    {connection && <div key={connection.id} ref={popup} className={styles.popup} role="dialog" aria-labelledby={popupId + "-title"} aria-describedby={connection.details.length > 0 ? popupId + "-details" : undefined}
      onPointerEnter={() => setOpened((current) => current?.leaving ? { ...current, leaving: false } : current)}
      onPointerLeave={() => setOpened((current) => leaveConnection(current, connection.id))}
      onFocus={() => setOpened((current) => current && !current.selected ? { ...current, selected: true, leaving: false } : current)}>
      <p id={popupId + "-title"} className={styles.popupTitle}>
        <TransportationIcons method={connection.method} size={13} className={styles.popupIcons} />
        <strong>{connection.from} <ArrowRight size={13} aria-hidden="true" /><span className="sr-only">to</span> {connection.to}</strong>
      </p>
      {connection.details.length > 0 && <dl id={popupId + "-details"} className={styles.popupDetails}>
        {connection.details.map((detail) => <div key={detail.term}><dt>{detail.term}</dt><dd>{detail.value}</dd></div>)}
      </dl>}
      <button type="button" className="text-button" onClick={() => { showOnPage(connection.target); setOpened(null); }}>View details<span className="sr-only"> for travel from {connection.from} to {connection.to}</span></button>
    </div>}
  </>;
}
