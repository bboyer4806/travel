"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { Check, ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import { formatMegabytes, IMAGE_UPLOAD_TYPES, MAX_CANDIDATE_IMAGES, MAX_GALLERY_UPLOAD_BYTES, MAX_IMAGE_UPLOAD_BYTES } from "@/lib/image-limits";
import type { Candidate } from "@/lib/types";
import { randomUuid } from "@/lib/uuid";
import { useFocusAfter } from "./focus-after";
import styles from "./candidate-gallery.module.css";

type ImageSubject = "hotel" | "activity" | "restaurant" | "church";
type GalleryOwner = Pick<Candidate, "id" | "name" | "images" | "mainImageId">;
type ImageKind = "candidate" | "church";
const subjectLabels: Record<ImageSubject, string> = { hotel: "Hotel", activity: "Activity", restaurant: "Restaurant", church: "Church" };

type DraftImage = { id: string; version?: string; file?: File };
export type CandidateGalleryDraft = { images: DraftImage[]; removedIds: string[]; mainImageId: string | null };

export function createCandidateGalleryDraft(candidate?: GalleryOwner): CandidateGalleryDraft {
  return { images: (candidate?.images ?? []).map((image) => ({ ...image })), removedIds: [], mainImageId: candidate?.mainImageId ?? null };
}

export function candidateGalleryForm(draft: CandidateGalleryDraft, candidate?: GalleryOwner): FormData | undefined {
  const added = draft.images.filter((image) => image.file);
  if (!added.length && !draft.removedIds.length && draft.mainImageId === (candidate?.mainImageId ?? null)) return undefined;
  const form = new FormData();
  form.set("gallery", JSON.stringify({ addIds: added.map((image) => image.id), removeIds: draft.removedIds, mainImageId: draft.mainImageId }));
  for (const image of added) if (image.file) form.set(`image:${image.id}`, image.file);
  return form;
}

function photoUrl(candidateId: string, image: { id: string; version?: string }, imageKind: ImageKind) {
  return `/api/${imageKind}-images/${candidateId}/${image.id}?v=${image.version}`;
}

export function CandidateGallery({ candidate, imageKind = "candidate" }: { candidate: GalleryOwner; imageKind?: ImageKind }) {
  if (!candidate.images.length) return null;
  return <GalleryView key={`${candidate.mainImageId}:${candidate.images.map((image) => `${image.id}:${image.version}`).join(",")}`} candidate={candidate} imageKind={imageKind} />;
}

function GalleryView({ candidate, imageKind }: { candidate: GalleryOwner; imageKind: ImageKind }) {
  const [selectedId, setSelectedId] = useState(candidate.mainImageId);
  const selected = candidate.images.find((image) => image.id === selectedId) ?? candidate.images[0];
  const index = candidate.images.findIndex((image) => image.id === selected.id);
  return <div className={styles.gallery} role="group" aria-label={`Photos of ${candidate.name}`}>
    <div className={styles.hero}>
      {/* Stored photos are resized and optimized on upload. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.image} src={photoUrl(candidate.id, selected, imageKind)} alt={`${candidate.name}, photo ${index + 1}`} loading="lazy" decoding="async" width={1600} height={700} />
      {selected.id === candidate.mainImageId && <span className={styles.mainBadge}>Main photo</span>}
      {candidate.images.length > 1 && <span className={styles.count}>{index + 1} / {candidate.images.length}</span>}
    </div>
    {candidate.images.length > 1 && <div className={styles.thumbnails} role="group" aria-label="Choose a photo to view">
      {candidate.images.map((image, photoIndex) => <button type="button" className={styles.thumbnail} key={image.id} aria-pressed={selected.id === image.id} aria-label={`View photo ${photoIndex + 1} of ${candidate.name}${image.id === candidate.mainImageId ? " (main photo)" : ""}`} onClick={() => setSelectedId(image.id)}>
        <SavedPhoto imageKind={imageKind} candidateId={candidate.id} image={image} alt="" />
        {image.id === candidate.mainImageId && <span className={styles.thumbnailMain} aria-hidden="true"><Check size={11} /></span>}
      </button>)}
    </div>}
  </div>;
}

function SavedPhoto({ candidateId, image, alt, imageKind }: { imageKind: ImageKind; candidateId: string; image: { id: string; version?: string }; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.image} src={photoUrl(candidateId, image, imageKind)} alt={alt} loading="lazy" decoding="async" width={240} height={160} />;
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

export function CandidateGalleryEditor({ candidate, subject, draft, onChange, disabled = false, imageKind = "candidate" }: {
  candidate?: GalleryOwner;
  subject: ImageSubject;
  imageKind?: ImageKind;
  draft: CandidateGalleryDraft;
  onChange: (draft: CandidateGalleryDraft) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const focusAfter = useFocusAfter();
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");
  const changed = draft.removedIds.length > 0 || draft.images.some((image) => image.file) || draft.mainImageId !== (candidate?.mainImageId ?? null);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (disabled || !files.length) return;
    let validationError = "";
    if (draft.images.length + files.length > MAX_CANDIDATE_IMAGES) validationError = `Keep up to ${MAX_CANDIDATE_IMAGES} photos. Remove a photo before adding more.`;
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
  function remove(image: DraftImage) {
    if (disabled) return;
    setError("");
    const next = draft.images[draft.images.indexOf(image) + 1];
    focusAfter(() => next ? removeButtons.current.get(next.id) : addButton.current);
    const images = draft.images.filter((item) => item.id !== image.id);
    onChange({ images, removedIds: image.file ? draft.removedIds : [...draft.removedIds, image.id], mainImageId: draft.mainImageId === image.id ? (images[0]?.id ?? null) : draft.mainImageId });
  }

  /** Undo photo changes goes away with the changes, so it focuses Add photos, or the last photo's Remove when the saved photos fill the gallery. */
  function undo() {
    const saved = createCandidateGalleryDraft(candidate);
    const last = saved.images.at(-1);
    focusAfter(() => last && saved.images.length >= MAX_CANDIDATE_IMAGES ? removeButtons.current.get(last.id) : addButton.current);
    setError("");
    onChange(saved);
  }

  return <fieldset className={styles.editor} disabled={disabled} aria-describedby={`${id}-hint`}>
    <legend>{subjectLabels[subject]} photos <span className={styles.optional}>(optional)</span></legend>
    <p id={`${id}-hint`} className={styles.hint}>Add up to {MAX_CANDIDATE_IMAGES} photos. Choose one main photo to show first.<br />JPEG, PNG, or WebP, up to {formatMegabytes(MAX_IMAGE_UPLOAD_BYTES)} each and {formatMegabytes(MAX_GALLERY_UPLOAD_BYTES)} of new photos per save.</p>
    <input ref={input} id={id} type="file" multiple accept={IMAGE_UPLOAD_TYPES.join(",")} onChange={choose} disabled={disabled} hidden aria-label={`Choose ${subject} photos`} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`} />
    {draft.images.length > 0 && <div className={styles.editGrid}>
      {draft.images.map((image, photoIndex) => <div key={image.id} className={styles.editPhoto}>
        <div className={styles.preview}>
          {image.file ? <UploadPreview file={image.file} alt={`New ${subject} photo ${photoIndex + 1}`} /> : candidate && <SavedPhoto imageKind={imageKind} candidateId={candidate.id} image={image} alt={`${subjectLabels[subject]} photo ${photoIndex + 1}`} />}
          {image.id === draft.mainImageId && <span className={styles.mainBadge}>Main photo</span>}
        </div>
        <p className={styles.filename} title={image.file?.name}>{image.file?.name ?? `Photo ${photoIndex + 1}`}</p>
        <div className={styles.photoActions}>
          <label className={styles.mainChoice}><input type="radio" name={`${id}-main-photo`} checked={image.id === draft.mainImageId} onChange={() => { setError(""); onChange({ ...draft, mainImageId: image.id }); }} disabled={disabled} aria-label={`Use photo ${photoIndex + 1} as the main photo`} /><span>Main photo</span></label>
          <button type="button" className={styles.remove} aria-label={`Remove photo ${photoIndex + 1}${image.file ? ` (${image.file.name})` : ""}`} disabled={disabled} onClick={() => remove(image)}
            ref={(button) => { if (button) removeButtons.current.set(image.id, button); else removeButtons.current.delete(image.id); }}><Trash2 size={14} aria-hidden="true" /><span>Remove</span></button>
        </div>
      </div>)}
    </div>}
    <div className={styles.actions}>
      <button type="button" ref={addButton} className="button secondary small" disabled={disabled || draft.images.length >= MAX_CANDIDATE_IMAGES} onClick={() => input.current?.click()}><ImagePlus size={15} aria-hidden="true" />Add photos</button>
      <span className={styles.photoCount}>{draft.images.length} / {MAX_CANDIDATE_IMAGES} photos</span>
      {changed && <button type="button" className={styles.restore} disabled={disabled} onClick={undo}><RotateCcw size={14} aria-hidden="true" />Undo photo changes</button>}
    </div>
    {error && <p id={`${id}-error`} className={styles.error} role="alert">{error}</p>}
    {changed && <p className={styles.status} role="status">Photo changes will be applied when you save this {subject}.</p>}
  </fieldset>;
}
