"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { NOT_FOUND_HELP, pageHelp } from "@/lib/help";

const HelpContext = createContext<(() => void) | null>(null);
/** Tells Help whether the not-found page is showing. Signed out, there is no Help to tell. */
const NotFoundContext = createContext<(showing: boolean) => void>(() => {});

/** Opens Help: in the header's navigation, and in an editor's heading, where it still describes the page beneath (TRA-3). */
export function HelpButton({ className, disabled, children }: { className: string; disabled?: boolean; children: ReactNode }) {
  const open = useContext(HelpContext);
  if (!open) throw new Error("Help opens only on signed-in pages, inside HelpProvider.");
  return <button type="button" className={className} disabled={disabled} onClick={open}>{children}</button>;
}

/** The not-found page's: while it shows, Help describes it rather than the page its address names, such as a trip no longer shared. */
export function NotFoundHelp() {
  const showing = useContext(NotFoundContext);
  useEffect(() => {
    showing(true);
    return () => showing(false);
  }, [showing]);
  return null;
}

/**
 * Help for the page shown, by its route (src/lib/help.ts). It opens above the page, and above an open editor, without
 * changing either, so an editor keeps its draft. X, Escape and the backdrop close it, and focus returns to its opener.
 */
export default function HelpProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [notFound, setNotFound] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const help = notFound ? NOT_FOUND_HELP : pageHelp(pathname);
  function open() {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
  }
  return <HelpContext.Provider value={open}><NotFoundContext.Provider value={setNotFound}>{children}
    <dialog ref={dialog} className="help-dialog" aria-labelledby="help-title" onClose={() => opener.current?.focus()} onClick={(event) => {
      // A click on the backdrop reaches the dialog itself, outside its box.
      if (event.target !== dialog.current) return;
      const box = dialog.current.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.current.close();
    }}>
      <div className="dialog-heading"><h2 id="help-title">Help: {help.title}</h2><button type="button" className="icon-button" aria-label="Close help" onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true" /></button></div>
      <ul className="help-points">{help.points.map((point) => <li key={point}>{point}</li>)}</ul>
    </dialog>
  </NotFoundContext.Provider></HelpContext.Provider>;
}
