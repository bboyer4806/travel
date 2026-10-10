"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import styles from "./destination-image.module.css";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type EditorProps = {
  existingSrc: string | null;
  file: File | null;
  removeExisting: boolean;
  onChange: (file: File | null, removeExisting: boolean) => void;
  disabled?: boolean;
};

export function DestinationImage({ src, name }: { src: string; name: string }) {
  return <div className={styles.banner}>
    {/* Stored images are already resized and optimized when uploaded. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className={styles.image} src={src} alt={name} loading="lazy" decoding="async" width={1600} height={700} />
  </div>;
}

function UploadPreview({ file }: { file: File }) {
  const image = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const previewUrl = URL.createObjectURL(file);
    if (image.current) image.current.src = previewUrl;
    return () => URL.revokeObjectURL(previewUrl);
  }, [file]);

  return <div className={styles.banner}>
    {/* Blob previews are local to this browser and cannot use server image optimization. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img ref={image} className={styles.image} alt="Selected destination image preview" width={1600} height={700} />
  </div>;
}

export function DestinationImageEditor({ existingSrc, file, removeExisting, onChange, disabled = false }: EditorProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const hasImage = Boolean(file || (existingSrc && !removeExisting));

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (disabled || !selected) return;
    if (!IMAGE_TYPES.has(selected.type.toLowerCase())) {
      setError("Choose a JPEG, PNG, or WebP image. Your previous selection has been kept.");
      return;
    }
    if (selected.size === 0) {
      setError("This image file is empty. Choose another image. Your previous selection has been kept.");
      return;
    }
    if (selected.size > MAX_IMAGE_BYTES) {
      setError("Choose an image up to 5 MB. Your previous selection has been kept.");
      return;
    }
    setError("");
    onChange(selected, false);
  }

  function remove() {
    if (disabled) return;
    setError("");
    onChange(null, true);
  }

  function restore() {
    if (disabled) return;
    setError("");
    onChange(null, false);
  }

  return <fieldset className={styles.editor} disabled={disabled} aria-describedby={`${id}-hint`}>
    <legend>Destination image <span className={styles.optional}>(optional)</span></legend>
    <p id={`${id}-hint`} className={styles.hint}>Add a photo to this destination. JPEG, PNG, or WebP, up to 5 MB.</p>
    <input ref={input} id={id} type="file" accept="image/jpeg,image/png,image/webp" onChange={choose}
      disabled={disabled} hidden aria-label="Destination image" aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`} />
    {hasImage && <div className={styles.preview}>
      {file ? <UploadPreview file={file} /> : existingSrc && <DestinationImage src={existingSrc} name="Current destination image" />}
    </div>}
    {file && <p className={styles.filename}>Selected: {file.name}</p>}
    <div className={styles.actions}>
      <button type="button" className="button secondary small" disabled={disabled} onClick={() => input.current?.click()}>
        <ImagePlus size={15} aria-hidden="true" />{hasImage ? "Replace image" : "Choose image"}
      </button>
      {hasImage && <button type="button" className={styles.remove} disabled={disabled} onClick={remove}>
        <Trash2 size={14} aria-hidden="true" />Remove image
      </button>}
      {existingSrc && (file || removeExisting) && <button type="button" className={styles.restore} disabled={disabled} onClick={restore}>
        <RotateCcw size={14} aria-hidden="true" />{removeExisting ? "Undo removal" : "Use saved image"}
      </button>}
    </div>
    {error && <p id={`${id}-error`} className={styles.error} role="alert">{error}</p>}
    {file && <p className={styles.status} role="status">Your image will be added when you save this destination.</p>}
    {!file && existingSrc && removeExisting && <p className={styles.status} role="status">The image will be removed when you save this destination.</p>}
  </fieldset>;
}
