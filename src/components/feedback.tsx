"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { MessageSquare, X } from "lucide-react";
import { FEEDBACK_FAILURE, FEEDBACK_LIMIT } from "@/lib/feedback";

const FeedbackContext = createContext<() => void>(() => {});
export function FeedbackButton({ compact = false }: { compact?: boolean }) {
  const open = useContext(FeedbackContext);
  return <button type="button" className={compact ? "text-button feedback-inline" : "button primary feedback-launcher"} onClick={open}><MessageSquare size={18} aria-hidden="true" />Send feedback</button>;
}

export default function FeedbackProvider({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pending = useRef(false);
  const opening = useRef(0);
  const token = useRef("");
  const readyAt = useRef(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const request = async (body: object) => {
    const response = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) }).catch(() => { throw new Error(FEEDBACK_FAILURE); });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || FEEDBACK_FAILURE);
    return result;
  };
  async function prepare() {
    const generation = ++opening.current;
    setReady(false); token.current = "";
    try {
      const result = await request({ action: "open" });
      if (generation !== opening.current) return;
      token.current = result.token;
      readyAt.current = Date.now() + 1100;
      setReady(true);
    } catch (cause) { if (generation === opening.current) setError(cause instanceof Error ? cause.message : FEEDBACK_FAILURE); }
  }
  function open() {
    if (dialog.current?.open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (sent) { setMessage(""); setSent(false); }
    setError("");
    dialog.current?.showModal();
    void prepare();
  }
  function close() {
    if (pending.current) return;
    opening.current++;
    dialog.current?.close();
    opener.current?.focus();
  }
  useEffect(() => () => { opening.current++; }, []);
  return <FeedbackContext.Provider value={open}>{children}<FeedbackButton />
    <dialog ref={dialog} className="feedback-dialog" aria-labelledby="feedback-title" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => {
      if (event.target !== dialog.current) return;
      const rect = dialog.current.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    }}>
      <div className="dialog-heading"><h2 id="feedback-title">Send feedback</h2><button type="button" className="icon-button" aria-label="Close feedback" disabled={busy} onClick={close}><X size={20} /></button></div>
      {sent ? <div className="feedback-body"><p role="status">Thanks, your feedback was sent.</p><button className="button secondary" onClick={close}>Close</button></div> : <form className="feedback-body" onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current) return;
        if (!message.trim()) { setError("Enter your feedback"); return; }
        const website = new FormData(event.currentTarget).get("website") ?? "";
        pending.current = true; setBusy(true); setError("");
        try {
          // Allow the invisible server challenge to mature, including very fast pastes.
          if (readyAt.current > Date.now()) await new Promise((resolve) => setTimeout(resolve, readyAt.current - Date.now()));
          await request({ message, page: location.pathname + location.search, viewport: `${window.innerWidth} × ${window.innerHeight}`, token: token.current, website });
          setSent(true);
        } catch (cause) { setError(cause instanceof Error ? cause.message : FEEDBACK_FAILURE); await prepare(); }
        finally { pending.current = false; setBusy(false); }
      }}>
        <label className="field"><span>Feedback</span><textarea name="message" rows={6} value={message} onChange={(event) => setMessage(event.target.value.slice(0, FEEDBACK_LIMIT))} maxLength={FEEDBACK_LIMIT} disabled={busy} aria-describedby="feedback-count feedback-error" autoFocus /></label>
        <div className="feedback-trap" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        <p id="feedback-count" className="helper">{message.length.toLocaleString()} / 2,000{message.length === FEEDBACK_LIMIT ? " — Character limit reached." : ""}</p>
        <p id="feedback-error" role="alert" className="form-error">{error}</p>
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={close} disabled={busy}>Cancel</button><button className="button primary" type="submit" disabled={busy || !ready}>{busy ? "Sending…" : "Send"}</button></div>
      </form>}
    </dialog>
  </FeedbackContext.Provider>;
}
