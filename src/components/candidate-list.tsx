import { ArrowDown, ArrowUp, Binoculars, Check, Clock, MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { CandidateGallery, GalleryPlaceholder } from "./candidate-gallery";
import { ResearchLinks } from "./research-links";
import { RestaurantTypeTags } from "./restaurant-types";
import { formatEstimatedTime } from "@/lib/estimated-time";
import { formatCurrency } from "@/lib/money";
import { HALF_PAGE } from "@/lib/photo-sizes";
import type { ReactNode } from "react";
import type { Candidate, Category, Destination, Mutation } from "@/lib/types";

const singular = { hotels: "hotel", activities: "activity", restaurants: "restaurant" };

export default function CandidateList({ items, category, destination, busy, onEdit, onDelete, onMutate, like }: {
  items: Candidate[];
  category: Category;
  destination: Destination;
  busy: boolean;
  onEdit: (item?: Candidate) => void;
  onDelete: (item: Candidate) => void;
  /** Saves a change made from `control`, which takes focus again once the page shows it, or at a list end the card's other direction. */
  onMutate: (mutation: Mutation, message: string, control: HTMLButtonElement) => void;
  /** An idea's Like, beside its Edit and Delete (TRA-31). */
  like: (item: Candidate) => ReactNode;
}) {
  const inactiveItemized = (category === "activities" && destination.activitiesBudgetMode === "general")
    || (category === "restaurants" && destination.foodBudgetMode === "daily");

  return <>
    {items.length > 0 && <div className="ideas-grid">
      {items.map((item, index) => <article className={item.included ? "idea-card included" : "idea-card"} key={item.id} aria-label={item.name}>
        {/* An activity without photos keeps the place its photos would take, so every activity's photo is the same size (TRA-124). */}
        {category === "activities" && !item.images.length ? <GalleryPlaceholder icon={Binoculars} /> : <CandidateGallery candidate={item} frame={HALF_PAGE} />}
        <div className="idea-top">
          <span className={item.included ? "selection-tag chosen" : "selection-tag"}>
            {item.included ? <><Check size={13} />{category === "hotels" ? "Chosen stay" : "In the plan"}</> : "A possibility"}
          </span>
          <div className="idea-tools">
            {like(item)}
            <button className="icon-button" disabled={busy} aria-label={"Edit " + item.name} onClick={() => onEdit(item)}><Pencil size={16} /></button>
            <button className="icon-button" disabled={busy} aria-label={"Delete " + item.name} onClick={() => onDelete(item)}><Trash2 size={16} /></button>
          </div>
        </div>
        <h2>{item.name}</h2>
        {item.description && <p className="idea-description">{item.description}</p>}
        <RestaurantTypeTags types={item.restaurantTypes} className="idea-types" />
        {category !== "hotels" && <button className={item.mustDo ? "button selected-button small must-do" : "button secondary small must-do"}
          disabled={busy} aria-pressed={item.mustDo}
          onClick={(event) => onMutate({ type: "candidate.mustDo", id: item.id, mustDo: !item.mustDo }, item.mustDo ? "Must do removed." : "Marked as must do.", event.currentTarget)}>
          <Star size={15} fill={item.mustDo ? "currentColor" : "none"} />{item.mustDo ? "Must do" : "Mark as must do"}<span className="sr-only"> for {item.name}</span>
        </button>}
        {/* An activity's estimated time, only when it has one (TRA-170). */}
        {item.estimatedMinutes !== null && <p className="idea-time"><Clock size={15} aria-hidden="true" /><span className="sr-only">Estimated time: </span>{formatEstimatedTime(item.estimatedMinutes)}</p>}
        {item.address && <p className="idea-address"><MapPin size={15} />{item.address}</p>}
        {item.notes && <p className="idea-notes">{item.notes}</p>}
        <ResearchLinks links={item.links ?? []} />
        <div className="idea-bottom">
          <div><span className={item.priceCents === null ? "idea-price unknown" : "idea-price"}>{item.priceCents === null ? "Not estimated" : formatCurrency(item.priceCents, "USD")}</span>
            <small>{category === "hotels" ? "entire stay · whole party" : category === "restaurants" ? "one meal · whole party" : "whole party"}</small></div>
          <button className={item.included ? "button selected-button small" : "button secondary small"} disabled={busy} aria-pressed={item.included}
            onClick={(event) => onMutate({ type: "candidate.include", id: item.id, included: !item.included }, "Budget selection saved.", event.currentTarget)}>
            {item.included ? <><Check size={15} />{inactiveItemized ? "Included for itemized" : "Included"}</> : category === "hotels" ? "Choose hotel" : inactiveItemized ? "Include for itemized" : "Include in budget"}
          </button>
        </div>
        <div className="idea-order" role="group" aria-label={"Order " + item.name}>
          <span>{index + 1} of {items.length}</span>
          <button className="button secondary small" disabled={busy || index === 0} aria-label={"Move " + item.name + " up"}
            onClick={(event) => onMutate({ type: "candidate.move", id: item.id, direction: "up" }, item.name + " moved up.", event.currentTarget)}><ArrowUp size={15} />Up</button>
          <button className="button secondary small" disabled={busy || index === items.length - 1} aria-label={"Move " + item.name + " down"}
            onClick={(event) => onMutate({ type: "candidate.move", id: item.id, direction: "down" }, item.name + " moved down.", event.currentTarget)}><ArrowDown size={15} />Down</button>
        </div>
      </article>)}
    </div>}
    <div className="ideas-add"><button className="button primary" disabled={busy} onClick={() => onEdit()}><Plus size={17} />Add {singular[category]}</button></div>
  </>;
}
