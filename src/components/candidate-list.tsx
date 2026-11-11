import { ArrowDown, ArrowUp, Check, MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { CandidateGallery } from "./candidate-gallery";
import { ResearchLinks } from "./research-links";
import { formatCurrency } from "@/lib/money";
import type { Candidate, Category, Destination, Mutation } from "@/lib/types";

const singular = { hotels: "hotel", activities: "activity", restaurants: "restaurant" };

export default function CandidateList({ items, category, destination, busy, onEdit, onDelete, onMutate }: {
  items: Candidate[];
  category: Category;
  destination: Destination;
  busy: boolean;
  onEdit: (item?: Candidate) => void;
  onDelete: (item: Candidate) => void;
  onMutate: (mutation: Mutation, message: string) => void;
}) {
  const focusAfterSave = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (busy || !focusAfterSave.current) return;
    const button = focusAfterSave.current;
    focusAfterSave.current = null;
    // Pending controls are disabled. Restore keyboard focus when saving ends;
    // at a list boundary, use the remaining available direction in this card.
    const target = button.disabled
      ? button.parentElement?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      : button;
    target?.focus({ preventScroll: true });
  }, [busy]);
  function change(mutation: Mutation, message: string, button: HTMLButtonElement) {
    focusAfterSave.current = button;
    onMutate(mutation, message);
  }
  const inactiveItemized = (category === "activities" && destination.activitiesBudgetMode === "general")
    || (category === "restaurants" && destination.foodBudgetMode === "daily");

  return <>
    {items.length > 0 && <div className="ideas-grid">
      {items.map((item, index) => <article className={item.included ? "idea-card included" : "idea-card"} key={item.id} aria-label={item.name}>
        <CandidateGallery candidate={item} />
        <div className="idea-top">
          <span className={item.included ? "selection-tag chosen" : "selection-tag"}>
            {item.included ? <><Check size={13} />{category === "hotels" ? "Chosen stay" : "In the plan"}</> : "A possibility"}
          </span>
          <div className="idea-tools">
            <button className="icon-button" disabled={busy} aria-label={"Edit " + item.name} onClick={() => onEdit(item)}><Pencil size={16} /></button>
            <button className="icon-button" disabled={busy} aria-label={"Delete " + item.name} onClick={() => onDelete(item)}><Trash2 size={16} /></button>
          </div>
        </div>
        <h2>{item.name}</h2>
        {category !== "hotels" && <button className={item.mustDo ? "button selected-button small must-do" : "button secondary small must-do"}
          disabled={busy} aria-pressed={item.mustDo} aria-label={"Must do: " + item.name}
          onClick={(event) => change({ type: "candidate.mustDo", id: item.id, mustDo: !item.mustDo }, item.mustDo ? "Must do removed." : "Marked as must do.", event.currentTarget)}>
          <Star size={15} fill={item.mustDo ? "currentColor" : "none"} />{item.mustDo ? "Must do" : "Mark as must do"}
        </button>}
        {item.address && <p className="idea-address"><MapPin size={15} />{item.address}</p>}
        {item.notes && <p className="idea-notes">{item.notes}</p>}
        <ResearchLinks links={item.links ?? []} />
        <div className="idea-bottom">
          <div><span className={item.priceCents === null ? "idea-price unknown" : "idea-price"}>{item.priceCents === null ? "Not estimated" : formatCurrency(item.priceCents, "USD")}</span>
            <small>{category === "hotels" ? "entire stay · whole party" : category === "restaurants" ? "one meal · whole party" : "whole party"}</small></div>
          <button className={item.included ? "button selected-button small" : "button secondary small"} disabled={busy} aria-pressed={item.included}
            onClick={(event) => change({ type: "candidate.include", id: item.id, included: !item.included }, "Budget selection saved.", event.currentTarget)}>
            {item.included ? <><Check size={15} />{inactiveItemized ? "Included for itemized" : "Included"}</> : category === "hotels" ? "Choose hotel" : inactiveItemized ? "Include for itemized" : "Include in budget"}
          </button>
        </div>
        <div className="idea-order" role="group" aria-label={"Order " + item.name}>
          <span>{index + 1} of {items.length}</span>
          <button className="button secondary small" disabled={busy || index === 0} aria-label={"Move " + item.name + " up"}
            onClick={(event) => change({ type: "candidate.move", id: item.id, direction: "up" }, item.name + " moved up.", event.currentTarget)}><ArrowUp size={15} />Up</button>
          <button className="button secondary small" disabled={busy || index === items.length - 1} aria-label={"Move " + item.name + " down"}
            onClick={(event) => change({ type: "candidate.move", id: item.id, direction: "down" }, item.name + " moved down.", event.currentTarget)}><ArrowDown size={15} />Down</button>
        </div>
      </article>)}
    </div>}
    <div className="ideas-add"><button className="button primary" disabled={busy} onClick={() => onEdit()}><Plus size={17} />Add {singular[category]}</button></div>
  </>;
}
