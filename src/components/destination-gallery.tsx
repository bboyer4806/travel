"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Crop, ImagePlus, LocateFixed, RotateCcw, Trash2 } from "lucide-react";
import { formatMegabytes, IMAGE_UPLOAD_TYPES, MAX_DESTINATION_IMAGES, MAX_GALLERY_UPLOAD_BYTES, MAX_IMAGE_UPLOAD_BYTES } from "@/lib/image-limits";
import { formatSavedDestinationLabel } from "@/lib/destination-label";
import { createGalleryDraft, focusPhoto, galleryChanged, movePhoto, placePhoto, removePhoto, type DraftImage, type GalleryDraft } from "@/lib/gallery-draft";
import { CENTERED, draggedFocus, objectPosition, photoFocus, type Size } from "@/lib/photo-focus";
import type { Destination, PhotoFocus } from "@/lib/types";
import { randomUuid } from "@/lib/uuid";
import { controlOrNeighbor, useFocusAfter } from "./focus-after";
import { usePhotoDrag } from "./photo-drag";
import styles from "./destination-gallery.module.css";

type DestinationGalleryOwner = Pick<Destination, "id" | "city" | "cityFromSuggestion" | "images" | "mainImageId">;

function photoUrl(destinationId: string, image: { id: string; version?: string }) {
  return `/api/destination-images/${destinationId}/${image.id}?v=${image.version}`;
}
/**
 * A photo's thumbnail (TRA-89), which the gallery's thumbnails, the editor's previews and the trip map's destination
 * previews (TRA-143) show in place of the photo.
 */
export function thumbnailUrl(destinationId: string, image: { id: string; version?: string }) {
  return `/api/destination-images/${destinationId}/${image.id}/thumbnail?v=${image.version}`;
}

export function DestinationGallery({ destination }: { destination: DestinationGalleryOwner }) {
  if (!destination.images.length) return null;
  return <GalleryView key={`${destination.mainImageId}:${destination.images.map((image) => `${image.id}:${image.version}`).join(",")}`} destination={destination} />;
}

function GalleryView({ destination }: { destination: DestinationGalleryOwner }) {
  const [selectedId, setSelectedId] = useState(destination.mainImageId);
  const selected = destination.images.find((image) => image.id === selectedId) ?? destination.images[0];
  const index = destination.images.findIndex((image) => image.id === selected.id);
  /** Shows the next (1) or previous (-1) photo in saved order, wrapping from the last photo to the first and the first to the last (TRA-123). */
  const step = (offset: -1 | 1) => setSelectedId(destination.images[(index + offset + destination.images.length) % destination.images.length].id);
  return <div className={styles.gallery} role="group" aria-label={`Photos of ${formatSavedDestinationLabel(destination)}`}>
    <div className={styles.hero}>
      {/* Stored photos are resized and optimized on upload. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.image} src={photoUrl(destination.id, selected)} alt={`${formatSavedDestinationLabel(destination)}, photo ${index + 1}`} loading="lazy" decoding="async" width={1600} height={700} style={{ objectPosition: objectPosition(selected) }} />
      {selected.id === destination.mainImageId && <span className={styles.mainBadge}>Primary photo</span>}
      {destination.images.length > 1 && <span className={styles.count}>{index + 1} / {destination.images.length}</span>}
      {destination.images.length > 1 && <>
        <button type="button" className={`${styles.arrow} ${styles.previous}`} aria-label={`Previous photo of ${formatSavedDestinationLabel(destination)}`} onClick={() => step(-1)}><ChevronLeft size={22} aria-hidden="true" /></button>
        <button type="button" className={`${styles.arrow} ${styles.next}`} aria-label={`Next photo of ${formatSavedDestinationLabel(destination)}`} onClick={() => step(1)}><ChevronRight size={22} aria-hidden="true" /></button>
      </>}
    </div>
    {destination.images.length > 1 && <div className={styles.thumbnails} role="group" aria-label="Choose a photo to view">
      {destination.images.map((image, photoIndex) => <button type="button" className={styles.thumbnail} key={image.id} aria-pressed={selected.id === image.id} aria-label={`View photo ${photoIndex + 1} of ${formatSavedDestinationLabel(destination)}${image.id === destination.mainImageId ? " (primary photo)" : ""}`} onClick={() => setSelectedId(image.id)}>
        <SavedPhoto destinationId={destination.id} image={image} alt="" focus={image} />
        {image.id === destination.mainImageId && <span className={styles.thumbnailMain} aria-hidden="true"><Check size={11} /></span>}
      </button>)}
    </div>}
  </div>;
}

/**
 * A destination's primary photo across the top of its card in Destinations (TRA-131), cropped around its focal point,
 * or nothing for a destination without photos, whose card looks as it always has. The destination's name follows it, so
 * it is decorative.
 */
export function DestinationCardPhoto({ destination }: { destination: Pick<Destination, "id" | "images" | "mainImageId"> }) {
  const photo = destination.images.find((image) => image.id === destination.mainImageId);
  if (!photo) return null;
  return <div className="trip-card-image">
    {/* Stored photos are resized and optimized on upload. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={photoUrl(destination.id, photo)} alt="" loading="lazy" decoding="async" style={{ objectPosition: objectPosition(photo) }} />
  </div>;
}

/** A saved photo, cropped to fit its frame around its focal point (TRA-53): its thumbnail (TRA-89), or with `full` the photo itself. */
function SavedPhoto({ destinationId, image, alt, focus, full = false }: { destinationId: string; image: { id: string; version?: string }; alt: string; focus: PhotoFocus; full?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.image} src={full ? photoUrl(destinationId, image) : thumbnailUrl(destinationId, image)} alt={alt} loading="lazy" decoding="async" width={240} height={160} style={{ objectPosition: objectPosition(focus) }} />;
}

/** A new photo before it is saved, cropped to fit its frame around its focal point (TRA-53). */
function UploadPreview({ file, alt, focus }: { file: File; alt: string; focus: PhotoFocus }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const previewUrl = URL.createObjectURL(file);
    if (image.current) image.current.src = previewUrl;
    return () => URL.revokeObjectURL(previewUrl);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} className={styles.image} alt={alt} width={240} height={160} style={{ objectPosition: objectPosition(focus) }} />;
}

/** A draft photo: a new one from its file, or a saved one of `destination`, as its thumbnail unless `full`. */
function DraftPhoto({ destination, image, alt, focus, full = false }: { destination?: DestinationGalleryOwner; image: DraftImage; alt: string; focus: PhotoFocus; full?: boolean }) {
  if (image.file) return <UploadPreview file={image.file} alt={alt} focus={focus} />;
  return destination ? <SavedPhoto destinationId={destination.id} image={image} alt={alt} focus={focus} full={full} /> : null;
}

/** A photo being dragged in the crop editor: the pointer dragging it, where it started, and the sizes its focal point moves by. */
type CropDrag = { pointerId: number; x: number; y: number; focus: PhotoFocus; frame: Size; natural: Size };

export function DestinationGalleryEditor({ destination, draft, onChange, disabled = false }: {
  destination?: DestinationGalleryOwner;
  draft: GalleryDraft;
  onChange: (draft: GalleryDraft) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const focusAfter = useFocusAfter();
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const cropButtons = useRef(new Map<string, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const resetButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");
  // The photo whose crop is being adjusted, with the focal point its crop editor shows, which Apply puts in the draft (TRA-53).
  const [crop, setCrop] = useState<{ id: string; focus: PhotoFocus } | null>(null);
  const cropDrag = useRef<CropDrag | null>(null);
  const changed = galleryChanged(draft, destination);
  const drag = usePhotoDrag(draft.images.map((image) => image.id), (photoId, index) => { setError(""); onChange(placePhoto(draft, photoId, index)); }, disabled);
  const cropIndex = crop ? draft.images.findIndex((image) => image.id === crop.id) : -1;

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (disabled || !files.length) return;
    let validationError = "";
    if (draft.images.length + files.length > MAX_DESTINATION_IMAGES) validationError = `Keep up to ${MAX_DESTINATION_IMAGES} photos. Remove a photo before adding more.`;
    else if (files.some((file) => !IMAGE_UPLOAD_TYPES.includes(file.type.toLowerCase()))) validationError = "Choose JPEG, PNG, or WebP photos.";
    else if (files.some((file) => file.size === 0)) validationError = "One of these files is empty. Choose another photo.";
    else if (files.some((file) => file.size > MAX_IMAGE_UPLOAD_BYTES)) validationError = `Choose photos up to ${formatMegabytes(MAX_IMAGE_UPLOAD_BYTES)} each.`;
    else if ([...draft.images.flatMap((image) => image.file ? [image.file] : []), ...files].reduce((total, file) => total + file.size, 0) > MAX_GALLERY_UPLOAD_BYTES) validationError = `Add up to ${formatMegabytes(MAX_GALLERY_UPLOAD_BYTES)} of new photos at a time. Save these photos before adding more.`;
    if (validationError) { setError(`${validationError} Your previous selections have been kept.`); return; }
    setError("");
    const added = files.map((file) => ({ id: randomUuid(), file }));
    const images = [...draft.images, ...added];
    onChange({ ...draft, images, mainImageId: draft.mainImageId ?? images[0].id });
  }

  /** Removes a photo and focuses the next photo's Remove, or Add photos after the last. */
  function remove(photoIndex: number) {
    const next = draft.images[photoIndex + 1];
    focusAfter(() => next ? removeButtons.current.get(next.id) : addButton.current);
    setError("");
    onChange(removePhoto(draft, draft.images[photoIndex].id));
  }

  /** Moves a photo and keeps focus on `control`, or on the photo's other move at the first or last place. */
  function move(photoIndex: number, direction: "left" | "right", control: HTMLButtonElement) {
    focusAfter(() => controlOrNeighbor(control));
    setError("");
    onChange(movePhoto(draft, draft.images[photoIndex].id, direction));
  }

  /** Undo photo changes goes away with the changes, so it focuses Add photos, or the last photo's Remove when the saved photos fill the gallery. */
  function undo() {
    const saved = createGalleryDraft(destination);
    const last = saved.images.at(-1);
    focusAfter(() => last && saved.images.length >= MAX_DESTINATION_IMAGES ? removeButtons.current.get(last.id) : addButton.current);
    setError("");
    onChange(saved);
  }

  /** Opens the crop editor in place of the photos, on the photo's focal point in the draft, and focuses its Reset to center (TRA-53). */
  function adjustCrop(image: DraftImage) {
    focusAfter(() => resetButton.current);
    setError("");
    setCrop({ id: image.id, focus: photoFocus(image) });
  }

  /** Closes the crop editor, putting its focal point in the draft with Apply, or discarding it with Cancel, and focuses the photo's Adjust crop. */
  function closeCrop(apply: boolean) {
    if (!crop) return;
    focusAfter(() => cropButtons.current.get(crop.id));
    if (apply) onChange(focusPhoto(draft, crop.id, crop.focus));
    setCrop(null);
  }

  /** Starts dragging the photo in the crop editor once it has loaded, capturing the pointer so the drag goes on outside the frame. */
  function startCropDrag(event: PointerEvent<HTMLDivElement>) {
    const image = event.currentTarget.querySelector("img");
    if (disabled || !crop || !image?.naturalWidth) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const { width, height } = image.getBoundingClientRect();
    cropDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, focus: crop.focus, frame: { width, height }, natural: { width: image.naturalWidth, height: image.naturalHeight } };
  }

  /** Moves the photo with the pointer dragging it, showing its new crop at once. */
  function moveCropDrag(event: PointerEvent<HTMLDivElement>) {
    const start = cropDrag.current;
    if (!crop || start?.pointerId !== event.pointerId) return;
    setCrop({ id: crop.id, focus: draggedFocus(start.focus, event.clientX - start.x, event.clientY - start.y, start.frame, start.natural) });
  }

  function endCropDrag(event: PointerEvent<HTMLDivElement>) {
    if (cropDrag.current?.pointerId === event.pointerId) cropDrag.current = null;
  }

  return <fieldset className={styles.editor} disabled={disabled} aria-describedby={`${id}-hint`}>
    <legend>Destination photos <span className={styles.optional}>(optional)</span></legend>
    <p id={`${id}-hint`} className={styles.hint}>Add up to {MAX_DESTINATION_IMAGES} photos. Choose a primary photo to show first and {drag.available && "drag photos or "}use Move left or Move right to arrange the gallery.<br />JPEG, PNG, or WebP, up to {formatMegabytes(MAX_IMAGE_UPLOAD_BYTES)} each and {formatMegabytes(MAX_GALLERY_UPLOAD_BYTES)} of new photos per save.</p>
    <input ref={input} id={id} type="file" multiple accept={IMAGE_UPLOAD_TYPES.join(",")} onChange={choose} disabled={disabled} hidden aria-label="Choose destination photos" aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`} />
    {/* TRA-53: the crop editor takes the photos' place, so nothing else changes the photos until Apply or Cancel. */}
    {crop && cropIndex >= 0 ? <div className={styles.crop} role="group" aria-labelledby={`${id}-crop-title`} aria-describedby={`${id}-crop-hint`}>
      <p id={`${id}-crop-title`} className={styles.cropTitle}>Adjust crop of photo {cropIndex + 1}</p>
      <div className={styles.cropFrame} onPointerDown={startCropDrag} onPointerMove={moveCropDrag} onPointerUp={endCropDrag} onPointerCancel={endCropDrag}>
        <DraftPhoto destination={destination} image={draft.images[cropIndex]} alt={`Photo ${cropIndex + 1}, cropped as the destination's main photo shows it`} focus={crop.focus} full />
      </div>
      <p id={`${id}-crop-hint`} className={styles.hint}>Drag the photo to choose what the destination&apos;s main photo shows. It is cropped to this shape on every screen, and the photo itself isn&apos;t changed.</p>
      <div className={styles.cropActions}>
        <button type="button" ref={resetButton} className={styles.restore} disabled={disabled} onClick={() => setCrop({ id: crop.id, focus: CENTERED })}><LocateFixed size={14} aria-hidden="true" />Reset to center</button>
        <button type="button" className="button secondary small" disabled={disabled} onClick={() => closeCrop(false)}>Cancel</button>
        <button type="button" className="button primary small" disabled={disabled} onClick={() => closeCrop(true)}>Apply</button>
      </div>
    </div> : <>
    {draft.images.length > 0 && <div className={styles.editGrid}>
      {draft.images.map((image, photoIndex) => <div key={image.id} className={styles.editPhoto} {...drag.target(image.id)}>
        <div className={styles.preview} {...drag.source(image.id)}>
          <DraftPhoto destination={destination} image={image} alt={`${image.file ? "New destination" : "Destination"} photo ${photoIndex + 1}`} focus={photoFocus(image)} />
          {image.id === draft.mainImageId && <span className={styles.mainBadge}>Primary photo</span>}
        </div>
        <p className={styles.filename} title={image.file?.name}>{image.file?.name ?? `Photo ${photoIndex + 1}`}</p>
        <div className={styles.photoActions}>
          <label className={styles.mainChoice}><input type="radio" name={`${id}-main-photo`} checked={image.id === draft.mainImageId} onChange={() => { setError(""); onChange({ ...draft, mainImageId: image.id }); }} disabled={disabled} aria-label={`Use photo ${photoIndex + 1} as the primary photo`} /><span>Primary photo</span></label>
          <button type="button" className={styles.remove} aria-label={`Remove photo ${photoIndex + 1}${image.file ? ` (${image.file.name})` : ""}`} disabled={disabled} onClick={() => remove(photoIndex)}
            ref={(button) => { if (button) removeButtons.current.set(image.id, button); else removeButtons.current.delete(image.id); }}><Trash2 size={14} aria-hidden="true" /><span>Remove</span></button>
        </div>
        <div className={styles.moveActions}>
          <button type="button" className={styles.move} disabled={disabled || photoIndex === 0} aria-label={`Move photo ${photoIndex + 1} left`} onClick={(event) => move(photoIndex, "left", event.currentTarget)}><ArrowLeft size={14} aria-hidden="true" />Move left</button>
          <button type="button" className={styles.move} disabled={disabled || photoIndex === draft.images.length - 1} aria-label={`Move photo ${photoIndex + 1} right`} onClick={(event) => move(photoIndex, "right", event.currentTarget)}><ArrowRight size={14} aria-hidden="true" />Move right</button>
        </div>
        <button type="button" className={styles.move} disabled={disabled} aria-label={`Adjust crop of photo ${photoIndex + 1}`} onClick={() => adjustCrop(image)}
          ref={(button) => { if (button) cropButtons.current.set(image.id, button); else cropButtons.current.delete(image.id); }}><Crop size={14} aria-hidden="true" />Adjust crop</button>
      </div>)}
    </div>}
    <div className={styles.actions}>
      <button type="button" ref={addButton} className="button secondary small" disabled={disabled || draft.images.length >= MAX_DESTINATION_IMAGES} onClick={() => input.current?.click()}><ImagePlus size={15} aria-hidden="true" />Add photos</button>
      <span className={styles.photoCount}>{draft.images.length} / {MAX_DESTINATION_IMAGES} photos</span>
      {changed && <button type="button" className={styles.restore} disabled={disabled} onClick={undo}><RotateCcw size={14} aria-hidden="true" />Undo photo changes</button>}
    </div>
    </>}
    {error && <p id={`${id}-error`} className={styles.error} role="alert">{error}</p>}
    {changed && <p className={styles.status} role="status">Photo changes will be applied when you save this destination.</p>}
  </fieldset>;
}
