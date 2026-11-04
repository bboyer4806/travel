"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, ArrowRight, Check, ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import { MAX_DESTINATION_IMAGES, MAX_GALLERY_UPLOAD_BYTES, MAX_IMAGE_UPLOAD_BYTES } from "@/lib/image-limits";
import { formatSavedDestinationLabel } from "@/lib/destination-label";
import { createDestinationGalleryDraft, destinationGalleryChanged, moveDestinationPhoto, removeDestinationPhoto, type DestinationGalleryDraft, type DestinationGalleryOwner } from "@/lib/destination-gallery";
import styles from "./destination-gallery.module.css";

export { createDestinationGalleryDraft, destinationGalleryForm, type DestinationGalleryDraft } from "@/lib/destination-gallery";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
function photoUrl(destinationId: string, image: { id: string; version?: string }) {
  return `/api/destination-images/${destinationId}/${image.id}?v=${image.version}`;
}

export function DestinationGallery({ destination }: { destination: DestinationGalleryOwner }) {
  if (!destination.images.length) return null;
  return <GalleryView key={`${destination.mainImageId}:${destination.images.map((image) => `${image.id}:${image.version}`).join(",")}`} destination={destination} />;
}

function GalleryView({ destination }: { destination: DestinationGalleryOwner }) {
  const [selectedId, setSelectedId] = useState(destination.mainImageId);
  const selected = destination.images.find((image) => image.id === selectedId) ?? destination.images[0];
  const index = destination.images.findIndex((image) => image.id === selected.id);
  return <div className={styles.gallery} role="group" aria-label={`Photos of ${formatSavedDestinationLabel(destination.city)}`}>
    <div className={styles.hero}>
      {/* Stored photos are resized and optimized on upload. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.image} src={photoUrl(destination.id, selected)} alt={`${formatSavedDestinationLabel(destination.city)}, photo ${index + 1}`} loading="lazy" decoding="async" width={1600} height={700} />
      {selected.id === destination.mainImageId && <span className={styles.mainBadge}>Primary photo</span>}
      {destination.images.length > 1 && <span className={styles.count}>{index + 1} / {destination.images.length}</span>}
    </div>
    {destination.images.length > 1 && <div className={styles.thumbnails} role="group" aria-label="Choose a photo to view">
      {destination.images.map((image, photoIndex) => <button type="button" className={styles.thumbnail} key={image.id} aria-pressed={selected.id === image.id} aria-label={`View photo ${photoIndex + 1} of ${formatSavedDestinationLabel(destination.city)}${image.id === destination.mainImageId ? " (primary photo)" : ""}`} onClick={() => setSelectedId(image.id)}>
        <SavedPhoto destinationId={destination.id} image={image} alt="" />
        {image.id === destination.mainImageId && <span className={styles.thumbnailMain} aria-hidden="true"><Check size={11} /></span>}
      </button>)}
    </div>}
  </div>;
}

function SavedPhoto({ destinationId, image, alt }: { destinationId: string; image: { id: string; version?: string }; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.image} src={photoUrl(destinationId, image)} alt={alt} loading="lazy" decoding="async" width={240} height={160} />;
}

function UploadPreview({ file, alt }: { file: File; alt: string }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const previewUrl = URL.createObjectURL(file);
    if (image.current) image.current.src = previewUrl;
    return () => URL.revokeObjectURL(previewUrl);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} className={styles.image} alt={alt} width={240} height={160} />;
}

export function DestinationGalleryEditor({ destination, draft, onChange, disabled = false }: {
  destination?: DestinationGalleryOwner;
  draft: DestinationGalleryDraft;
  onChange: (draft: DestinationGalleryDraft) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const changed = destinationGalleryChanged(draft, destination);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (disabled || !files.length) return;
    let validationError = "";
    if (draft.images.length + files.length > MAX_DESTINATION_IMAGES) validationError = `Keep up to ${MAX_DESTINATION_IMAGES} photos. Remove a photo before adding more.`;
    else if (files.some((file) => !IMAGE_TYPES.has(file.type.toLowerCase()))) validationError = "Choose JPEG, PNG, or WebP photos.";
    else if (files.some((file) => file.size === 0)) validationError = "One of these files is empty. Choose another photo.";
    else if (files.some((file) => file.size > MAX_IMAGE_UPLOAD_BYTES)) validationError = "Choose photos up to 5 MB each.";
    else if ([...draft.images.flatMap((image) => image.file ? [image.file] : []), ...files].reduce((total, file) => total + file.size, 0) > MAX_GALLERY_UPLOAD_BYTES) validationError = "Add up to 15 MB of new photos at a time. Save these photos before adding more.";
    if (validationError) { setError(`${validationError} Your previous selections have been kept.`); return; }
    setError("");
    const added = files.map((file) => ({ id: crypto.randomUUID(), file }));
    const images = [...draft.images, ...added];
    onChange({ ...draft, images, mainImageId: draft.mainImageId ?? images[0].id });
  }

  return <fieldset className={styles.editor} disabled={disabled} aria-describedby={`${id}-hint`}>
    <legend>Destination photos <span className={styles.optional}>(optional)</span></legend>
    <p id={`${id}-hint`} className={styles.hint}>Add up to {MAX_DESTINATION_IMAGES} photos. Choose a primary photo to show first and use Move left or Move right to arrange the gallery.<br />JPEG, PNG, or WebP, up to 5 MB each and 15 MB of new photos per save.</p>
    <input ref={input} id={id} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={choose} disabled={disabled} hidden aria-label="Choose destination photos" aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`} />
    {draft.images.length > 0 && <div className={styles.editGrid}>
      {draft.images.map((image, photoIndex) => <div key={image.id} className={styles.editPhoto}>
        <div className={styles.preview}>
          {image.file ? <UploadPreview file={image.file} alt={`New destination photo ${photoIndex + 1}`} /> : destination && <SavedPhoto destinationId={destination.id} image={image} alt={`Destination photo ${photoIndex + 1}`} />}
          {image.id === draft.mainImageId && <span className={styles.mainBadge}>Primary photo</span>}
        </div>
        <p className={styles.filename} title={image.file?.name}>{image.file?.name ?? `Photo ${photoIndex + 1}`}</p>
        <div className={styles.photoActions}>
          <label className={styles.mainChoice}><input type="radio" name={`${id}-main-photo`} checked={image.id === draft.mainImageId} onChange={() => { setError(""); onChange({ ...draft, mainImageId: image.id }); }} disabled={disabled} aria-label={`Use photo ${photoIndex + 1} as the primary photo`} /><span>Primary photo</span></label>
          <button type="button" className={styles.remove} aria-label={`Remove photo ${photoIndex + 1}${image.file ? ` (${image.file.name})` : ""}`} disabled={disabled} onClick={() => { setError(""); onChange(removeDestinationPhoto(draft, image.id)); }}><Trash2 size={14} aria-hidden="true" /><span>Remove</span></button>
        </div>
        <div className={styles.moveActions}>
          <button type="button" className={styles.move} disabled={disabled || photoIndex === 0} aria-label={`Move photo ${photoIndex + 1} left`} onClick={() => { setError(""); onChange(moveDestinationPhoto(draft, image.id, "left")); }}><ArrowLeft size={14} aria-hidden="true" />Move left</button>
          <button type="button" className={styles.move} disabled={disabled || photoIndex === draft.images.length - 1} aria-label={`Move photo ${photoIndex + 1} right`} onClick={() => { setError(""); onChange(moveDestinationPhoto(draft, image.id, "right")); }}><ArrowRight size={14} aria-hidden="true" />Move right</button>
        </div>
      </div>)}
    </div>}
    <div className={styles.actions}>
      <button type="button" className="button secondary small" disabled={disabled || draft.images.length >= MAX_DESTINATION_IMAGES} onClick={() => input.current?.click()}><ImagePlus size={15} aria-hidden="true" />Add photos</button>
      <span className={styles.photoCount}>{draft.images.length} / {MAX_DESTINATION_IMAGES} photos</span>
      {changed && <button type="button" className={styles.restore} disabled={disabled} onClick={() => { setError(""); onChange(createDestinationGalleryDraft(destination)); }}><RotateCcw size={14} aria-hidden="true" />Undo photo changes</button>}
    </div>
    {error && <p id={`${id}-error`} className={styles.error} role="alert">{error}</p>}
    {changed && <p className={styles.status} role="status">Photo changes will be applied when you save this destination.</p>}
  </fieldset>;
}
