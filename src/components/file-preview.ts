import { useEffect, useRef } from "react";

/** Travel's previews of files the browser couldn't show, so each file is sent once, however many previews show it. */
const previews = new WeakMap<File, Promise<Blob | null>>();

/**
 * Travel's preview of a file the browser couldn't show (TRA-179), as the photo it would save of it, or null when Travel
 * can't read the file either, which saving it then says.
 */
function travelPreview(file: File): Promise<Blob | null> {
  let preview = previews.get(file);
  if (!preview) {
    preview = fetch("/api/image-preview", { method: "POST", body: file }).then((response) => response.ok ? response.blob() : null).catch(() => null);
    previews.set(file, preview);
  }
  return preview;
}

/**
 * Shows a new photo, a file chosen from the device or an image added by URL, in the image element given the returned
 * ref: as the browser decodes it, or, when the browser can't, as for a HEIC photo outside Safari, as Travel's preview of
 * it (TRA-179).
 */
export function useFilePreview(file: File | null) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const element = image.current;
    if (!file || !element) return;
    const urls = [URL.createObjectURL(file)];
    let showing = true;
    const showTravelPreview = () => void travelPreview(file).then((preview) => {
      if (!preview || !showing) return;
      urls.push(URL.createObjectURL(preview));
      element.src = urls[1];
    });
    element.addEventListener("error", showTravelPreview, { once: true });
    element.src = urls[0];
    return () => {
      showing = false;
      element.removeEventListener("error", showTravelPreview);
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [file]);
  return image;
}
