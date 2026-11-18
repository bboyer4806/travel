"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import { ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import { formatMegabytes, IMAGE_UPLOAD_TYPES, MAX_IMAGE_UPLOAD_BYTES } from "@/lib/image-limits";
import { cropStyle, draggedFocus, MAX_PHOTO_ZOOM, UNCROPPED, type Size } from "@/lib/photo-focus";
import { createTripImageDraft, tripImageChanged, type TripImageDraft } from "@/lib/trip-image-draft";
import type { PhotoCrop, Trip, TripImageCrops } from "@/lib/types";
import { useFocusAfter } from "./focus-after";
import { AddImageByUrl } from "./image-by-url";
import styles from "./trip-image.module.css";

/** Where a trip's headline image shows (TRA-133): across the top of its card on All trips, or as the banner on its page. */
type Frame = keyof TripImageCrops;
type TripWithImage = Pick<Trip, "id" | "image">;

/** A saved headline image's address, which names its version, so browsers keep it until it is replaced. */
function imageUrl(tripId: string, version: string) {
  return `/api/trip-images/${tripId}?v=${version}`;
}

/**
 * A trip's headline image cropped for its card or for its banner (TRA-133), or nothing for a trip without one, which looks
 * as it always has. The trip's name follows it, so it is decorative.
 */
export function TripImageView({ trip, frame }: { trip: TripWithImage; frame: Frame }) {
  if (!trip.image) return null;
  return <div className={frame === "card" ? "trip-card-image" : "trip-banner"}>
    {/* Stored images are resized and optimized on upload. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={imageUrl(trip.id, trip.image.version)} alt="" loading={frame === "card" ? "lazy" : "eager"} decoding="async" style={cropStyle(trip.image[frame])} />
  </div>;
}

/** The draft's image, a new one from its file or the saved one from its address, cropped as `crop` says. */
function DraftImage({ source, crop, alt }: { source: File | string; crop: PhotoCrop; alt: string }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (typeof source === "string") return;
    const previewUrl = URL.createObjectURL(source);
    if (image.current) image.current.src = previewUrl;
    return () => URL.revokeObjectURL(previewUrl);
  }, [source]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} src={typeof source === "string" ? source : undefined} alt={alt} style={cropStyle(crop)} />;
}

/** An image being dragged in a preview: the pointer dragging it, where it started, the sizes its focal point moves by, and its crop so far. */
type CropDrag = { pointerId: number; x: number; y: number; start: PhotoCrop; frame: Size; natural: Size; crop: PhotoCrop };

/**
 * One of the headline image's crops (TRA-133), in the shape its card or banner has on every screen. Dragging the image with
 * a mouse or finger moves it as far as its edges, and the slider zooms it in about its focal point, each shown at once. A
 * drag's crop goes in the draft when the drag ends, and a zoom when the slider is let go, so meanwhile only this preview
 * changes, however large the page beneath the editor.
 */
function CropPreview({ id, frame, label, source, crop, disabled, onCrop }: { id: string; frame: Frame; label: string; source: File | string; crop: PhotoCrop; disabled: boolean; onCrop: (crop: PhotoCrop) => void }) {
  const [dragged, setDragged] = useState<PhotoCrop | null>(null);
  const [zooming, setZooming] = useState<number | null>(null);
  const drag = useRef<CropDrag | null>(null);
  const slider = useRef<HTMLInputElement>(null);
  const shown = dragged ?? (zooming === null ? crop : { ...crop, zoom: zooming });
  const percent = `${Math.round(shown.zoom * 100)}%`;
  // The slider's `change`, which React doesn't report apart from its `input`, comes when it is let go, or with each key press.
  const zoomed = useEffectEvent(() => {
    const zoom = Number(slider.current?.value ?? crop.zoom);
    setZooming(null);
    if (zoom !== crop.zoom) onCrop({ ...crop, zoom });
  });
  useEffect(() => {
    const input = slider.current;
    input?.addEventListener("change", zoomed);
    return () => input?.removeEventListener("change", zoomed);
  }, []);

  /** Starts dragging once the image has loaded, capturing the pointer so the drag goes on outside the frame. */
  function start(event: PointerEvent<HTMLDivElement>) {
    const image = event.currentTarget.querySelector("img");
    if (disabled || drag.current || !image?.naturalWidth) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    // The image's own box is the frame's: zooming scales it without changing its layout size.
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: crop, frame: { width: image.offsetWidth, height: image.offsetHeight }, natural: { width: image.naturalWidth, height: image.naturalHeight }, crop };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    const { start: from } = current;
    current.crop = { ...draggedFocus(from, event.clientX - current.x, event.clientY - current.y, current.frame, current.natural, from.zoom), zoom: from.zoom };
    setDragged(current.crop);
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragged(null);
    if (current.crop.focusX !== current.start.focusX || current.crop.focusY !== current.start.focusY) onCrop(current.crop);
  }

  return <div className={styles.preview} role="group" aria-labelledby={`${id}-title`}>
    <p id={`${id}-title`} className={styles.previewTitle}>{label}</p>
    <div className={`${styles.frame} ${styles[frame]}`} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <DraftImage source={source} crop={shown} alt={`Headline image as the ${label.toLowerCase()} shows it`} />
    </div>
    <div className={styles.zoom}>
      <label htmlFor={`${id}-zoom`}><span className="sr-only">{label} </span>Zoom</label>
      <input ref={slider} id={`${id}-zoom`} type="range" min={1} max={MAX_PHOTO_ZOOM} step={0.01} value={shown.zoom} disabled={disabled} aria-valuetext={percent}
        onChange={(event) => setZooming(Number(event.currentTarget.value))} />
      <output htmlFor={`${id}-zoom`}>{percent}</output>
    </div>
  </div>;
}

/**
 * The trip editor's headline image (TRA-133): Add image chooses one from the device, or Add image by URL from the web
 * (TRA-139), and its card and banner previews each crop it their own way. Replace image, Remove image and Undo image
 * changes change the draft, which saving the trip saves and Cancel discards.
 */
export function TripImageEditor({ trip, draft, onChange, disabled }: { trip?: TripWithImage; draft: TripImageDraft; onChange: (draft: TripImageDraft) => void; disabled: boolean }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const focusAfter = useFocusAfter();
  const [error, setError] = useState("");
  const saved = trip?.image ?? null;
  const changed = tripImageChanged(draft, saved);
  // A saved image's draft exists only for a trip that has one.
  const source = draft === null ? null : "file" in draft ? draft.file : trip && imageUrl(trip.id, draft.version);

  /**
   * A new image, a file chosen from the device or an image added by URL (TRA-139), checked as uploads are on the server,
   * replaces the draft's and starts uncropped. A refused image keeps the draft and says why, and returns false.
   */
  function addImage(file: File): boolean {
    const refused = !IMAGE_UPLOAD_TYPES.includes(file.type.toLowerCase()) ? "Choose a JPEG, PNG, or WebP image."
      : file.size === 0 ? "That image is empty. Choose another image."
      : file.size > MAX_IMAGE_UPLOAD_BYTES ? `Choose an image up to ${formatMegabytes(MAX_IMAGE_UPLOAD_BYTES)}.` : "";
    if (refused) {
      setError(draft ? `${refused} Your previous image has been kept.` : refused);
      return false;
    }
    setError("");
    onChange({ file, card: UNCROPPED, banner: UNCROPPED });
    return true;
  }
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (disabled || !file) return;
    addImage(file);
  }
  /** Remove image and Undo image changes go away with the changes they make, so Add image or Replace image takes focus. */
  function change(next: TripImageDraft) {
    focusAfter(() => chooseButton.current);
    setError("");
    onChange(next);
  }

  return <fieldset className={styles.editor} disabled={disabled} aria-describedby={`${id}-hint`}>
    <legend>Headline image <span className={styles.optional}>(optional)</span></legend>
    <p id={`${id}-hint`} className={styles.hint}>Shown across the top of the trip&apos;s card on All trips and as a banner on its page. Drag each preview to choose what it shows, and zoom with its slider.<br />JPEG, PNG, or WebP, up to {formatMegabytes(MAX_IMAGE_UPLOAD_BYTES)}.</p>
    <input ref={input} type="file" accept={IMAGE_UPLOAD_TYPES.join(",")} onChange={choose} disabled={disabled} hidden aria-label="Choose a headline image" />
    {draft && source && <div className={styles.previews}>
      <CropPreview id={`${id}-card`} frame="card" label="Trip card" source={source} crop={draft.card} disabled={disabled} onCrop={(card) => onChange({ ...draft, card })} />
      <CropPreview id={`${id}-banner`} frame="banner" label="Trip page banner" source={source} crop={draft.banner} disabled={disabled} onCrop={(banner) => onChange({ ...draft, banner })} />
    </div>}
    <div className={styles.actions}>
      <button type="button" ref={chooseButton} className="button secondary small" disabled={disabled} onClick={() => input.current?.click()}><ImagePlus size={15} aria-hidden="true" />{draft ? "Replace image" : "Add image"}</button>
      <AddImageByUrl label={draft ? "Replace image by URL" : "Add image by URL"} disabled={disabled} onAdd={addImage} />
      {draft && <button type="button" className={styles.remove} disabled={disabled} onClick={() => change(null)}><Trash2 size={14} aria-hidden="true" />Remove image</button>}
      {changed && saved && <button type="button" className={styles.restore} disabled={disabled} onClick={() => change(createTripImageDraft(saved))}><RotateCcw size={14} aria-hidden="true" />Undo image changes</button>}
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {changed && <p className={styles.status} role="status">Image changes will be saved with the trip.</p>}
  </fieldset>;
}
