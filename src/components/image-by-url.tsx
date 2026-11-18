"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link2 } from "lucide-react";
import { formatMegabytes, MAX_IMAGE_UPLOAD_BYTES } from "@/lib/image-limits";
import { controlOrNeighbor, useFocusAfter } from "./focus-after";
import styles from "./image-by-url.module.css";

/** Why an image couldn't be downloaded, when Travel's answer doesn't say. */
const FAILED = "Travel couldn't download this image. Check your connection and try again.";

/**
 * The name an image added by URL shows in a photo editor, as a file chosen from the device shows its file name: the last
 * part of its address's path, or its host when the path is empty.
 */
export function imageName(address: string): string {
  const url = new URL(address);
  const name = url.pathname.split("/").filter(Boolean).at(-1);
  if (!name) return url.hostname;
  try {
    return decodeURIComponent(name);
  } catch {
    // A name that isn't valid percent-encoding shows as written.
    return name;
  }
}

/** Has Travel download the image at `url` (TRA-139): the image, as a file named for its address, or why it can't be used. */
async function download(url: string, signal: AbortSignal): Promise<{ file: File } | { error: string }> {
  const response = await fetch("/api/image-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }), signal });
  if (!response.ok) return { error: ((await response.json().catch(() => ({}))) as { error?: string }).error ?? FAILED };
  const blob = await response.blob();
  return { file: new File([blob], imageName(url), { type: blob.type }) };
}

/** The downloaded image, shown whole for review before it is used. */
function Preview({ file }: { file: File }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const previewUrl = URL.createObjectURL(file);
    if (image.current) image.current.src = previewUrl;
    return () => URL.revokeObjectURL(previewUrl);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} className={styles.image} alt="Preview of the image at this address" />;
}

/**
 * Add image by URL (TRA-139), beside a photo editor's button for choosing files. `label` opens a field for an image's web
 * address, and Preview has Travel download the image and shows it. Use this image gives it to `onAdd` as the file it
 * would be if chosen from the device, for the editor to check and add as it adds those; `onAdd` returns false when the
 * editor refuses it, saying why itself. Cancel, or `label` again, closes the field.
 */
export function AddImageByUrl({ label, disabled, onAdd }: { label: string; disabled: boolean; onAdd: (file: File) => boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const focusAfter = useFocusAfter();
  // Closing the editor stops a download on its way.
  useEffect(() => () => request.current?.abort(), []);

  /** Stops a download on its way and forgets the image or error shown. */
  function clear() {
    request.current?.abort();
    request.current = null;
    setDownloading(false);
    setFile(null);
    setError("");
  }

  /** Closes the field, which focuses its button again, or the control beside it once the button turns off, as when the photos are full. */
  function close() {
    clear();
    setAddress("");
    focusAfter(() => toggle.current && controlOrNeighbor(toggle.current));
    setOpen(false);
  }

  /** Downloads the image at the address entered and shows it, or says why it can't be used. */
  async function preview() {
    const url = address.trim();
    clear();
    if (!url) {
      setError("Enter the image's web address.");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setDownloading(true);
    const result = await download(url, controller.signal).catch(() => ({ error: FAILED }));
    // Another preview, a changed address, Cancel or closing the editor stopped this one.
    if (controller.signal.aborted) return;
    request.current = null;
    setDownloading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setFile(result.file);
  }

  function accept() {
    if (file && onAdd(file)) close();
  }

  /** Enter in the address previews the image, rather than saving the editor. */
  function enter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void preview();
  }

  return <>
    <button type="button" ref={toggle} className="button secondary small" disabled={disabled} aria-expanded={open} aria-controls={open ? `${id}-panel` : undefined} onClick={open ? close : () => setOpen(true)}><Link2 size={15} aria-hidden="true" />{label}</button>
    {open && <div id={`${id}-panel`} className={styles.panel} role="group" aria-label={label}>
      <label className={styles.label} htmlFor={`${id}-address`}>Image URL</label>
      <div className={styles.entry}>
        {/* The field opens for typing an address, so the address takes focus as it opens. */}
        <input id={`${id}-address`} className={styles.address} type="text" inputMode="url" autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="https://" value={address}
          onChange={(event) => { clear(); setAddress(event.currentTarget.value); }} onKeyDown={enter} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`} />
        <button type="button" className="button secondary small" onClick={() => void preview()}>Preview</button>
      </div>
      <p id={`${id}-hint`} className={styles.hint}>The address of the image itself, not of the page it&apos;s on: a JPEG, PNG, or WebP image up to {formatMegabytes(MAX_IMAGE_UPLOAD_BYTES)}. Travel saves its own copy.</p>
      {(downloading || file) && <p className={styles.status} role="status">{downloading ? "Downloading the image…" : "Check the image, then choose Use this image."}</p>}
      {error && <p id={`${id}-error`} className={styles.error} role="alert">{error}</p>}
      {file && <div className={styles.preview}><Preview file={file} /></div>}
      <div className={styles.actions}>
        <button type="button" className="button secondary small" onClick={close}>Cancel</button>
        {file && <button type="button" className="button primary small" disabled={disabled} onClick={accept}>Use this image</button>}
      </div>
    </div>}
  </>;
}
