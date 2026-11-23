"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { BedDouble, Binoculars, Check, ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, Utensils } from "lucide-react";
import { CandidateGallery, largeUrl, photoUrl } from "./candidate-gallery";
import { CoordinatesDetail } from "./place-location";
import { ResearchLinks } from "./research-links";
import { RestaurantTypeTags } from "./restaurant-types";
import { formatCurrency } from "@/lib/money";
import { CAROUSEL_CARD, DIALOG, photoSizes } from "@/lib/photo-sizes";
import type { Candidate, Category } from "@/lib/types";
import styles from "./destination-ideas.module.css";

const categories: Category[] = ["hotels", "activities", "restaurants"];
const labels = { hotels: "Hotels", activities: "Activities", restaurants: "Restaurants" };
const subjects = { hotels: "Hotel", activities: "Activity", restaurants: "Restaurant" };
const icons = { hotels: BedDouble, activities: Binoculars, restaurants: Utensils };
/** How a card marks an idea chosen for the budget, as its full page does. */
const chosen = { hotels: "Chosen stay", activities: "In the plan", restaurants: "In the plan" };
/** What an idea's price covers, in its editor and its details. */
export const priceNotes = {
  hotels: "Total for all rooms and the entire stay.",
  activities: "Total for the whole party for this activity.",
  restaurants: "Total for one meal for the whole party.",
};
/** An idea's budget selection, as its editor's checkbox and its details name it. */
export const selectionLabels = {
  hotels: "Choose this hotel for the budget",
  activities: "Include in itemized activity costs",
  restaurants: "Include in itemized restaurant costs",
};

const price = (item: Candidate) => item.priceCents === null ? "Not estimated" : formatCurrency(item.priceCents, "USD");

/**
 * Ideas in the order a destination's carousels show them: those chosen for the budget first, then the rest, each group in
 * its saved order (TRA-120). An activity's dialog steps through its destination's activities in this order (TRA-160).
 */
export function carouselOrder(ideas: Candidate[]): Candidate[] {
  return [...ideas.filter((item) => item.included), ...ideas.filter((item) => !item.included)];
}

/**
 * A destination's Hotels, Activities and Restaurants, below its budget (TRA-120). Each section starts expanded on every
 * page load and opens and closes on its own; toggling saves nothing. Its carousel shows the ideas chosen for the budget
 * first, then the rest, each group in its saved order. Selecting a card shows that idea's details. Each section edits
 * its category's budget, adds an idea, and links to its full page under `pages`, where ideas are reordered and deleted.
 */
export function DestinationIdeas({ ideas, city, pages, busy, onView, onAdd, onBudgetEdit }: {
  /** The destination's ideas, in their saved order. */
  ideas: Candidate[];
  /** The destination's name, for screen readers. */
  city: string;
  pages: string;
  busy: boolean;
  onView: (item: Candidate) => void;
  onAdd: (category: Category) => void;
  onBudgetEdit: (category: Category) => void;
}) {
  return <>{categories.map((category) => <IdeaSection key={category} category={category} ideas={ideas.filter((item) => item.category === category)} city={city} href={pages + "/" + category} busy={busy}
    onView={onView} onAdd={() => onAdd(category)} onBudgetEdit={() => onBudgetEdit(category)} />)}</>;
}

function IdeaSection({ category, ideas, city, href, busy, onView, onAdd, onBudgetEdit }: { category: Category; ideas: Candidate[]; city: string; href: string; busy: boolean; onView: (item: Candidate) => void; onAdd: () => void; onBudgetEdit: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  const name = labels[category];
  return <section className={styles.section} aria-label={name}>
    <div className="section-heading">
      <h4><button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded((open) => !open)}>{name}<span className={styles.count}>({ideas.length})</span><ChevronDown size={18} aria-hidden="true" /></button></h4>
      <div className={styles.actions}>
        <button type="button" className="button secondary small" disabled={busy} onClick={onBudgetEdit}><Pencil size={15} aria-hidden="true" />Edit budget<span className="sr-only"> for {name.toLowerCase()} in {city}</span></button>
        <button type="button" className="button secondary small" disabled={busy} onClick={onAdd}><Plus size={15} aria-hidden="true" />Add {subjects[category].toLowerCase()}<span className="sr-only"> in {city}</span></button>
      </div>
    </div>
    <div id={contentId} className={styles.content} hidden={!expanded}>
      {ideas.length ? <Carousel category={category} ideas={carouselOrder(ideas)} onView={onView} />
        : <p className={styles.empty}>No {name.toLowerCase()} saved yet.</p>}
      <Link className={"text-button " + styles.manage} href={href}>Manage {name.toLowerCase()}<span className="sr-only"> in {city}</span></Link>
    </div>
  </section>;
}

/**
 * One card per idea, scrolled sideways by its arrows, or by swiping or scrolling. The arrows loop (TRA-127): Next at the
 * end returns to the start, and Previous at the start goes to the end. Swiping and scrolling stop at either end.
 */
function Carousel({ category, ideas, onView }: { category: Category; ideas: Candidate[]; onView: (item: Candidate) => void }) {
  const track = useRef<HTMLUListElement>(null);
  // Both arrows work while the cards overflow the list, at either end too. Until the list is measured, neither does.
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const list = track.current;
    if (!list) return;
    // A new observer measures once when it starts, then whenever the list resizes, as when its section opens. Widths
    // round, so a pixel of overflow fits.
    const resizing = new ResizeObserver(() => setOverflows(list.scrollWidth - list.clientWidth > 1));
    resizing.observe(list);
    return () => resizing.disconnect();
  }, [ideas.length]);
  /** Scrolls the cards a list's width in `direction`, or from the end it points to, within a pixel, to the other end. */
  const scroll = (direction: -1 | 1) => {
    const list = track.current!;
    const last = list.scrollWidth - list.clientWidth;
    if (direction === 1 && list.scrollLeft >= last - 1) list.scrollTo({ left: 0 });
    else if (direction === -1 && list.scrollLeft <= 1) list.scrollTo({ left: last });
    else list.scrollBy({ left: direction * list.clientWidth });
  };
  const Icon = icons[category];
  const name = labels[category].toLowerCase();
  return <div className={styles.carousel}>
    <button type="button" className={styles.arrow + " " + styles.previous} aria-label={"Previous " + name} disabled={!overflows} onClick={() => scroll(-1)}><ChevronLeft size={20} aria-hidden="true" /></button>
    <ul ref={track} className={styles.track}>
      {ideas.map((item) => {
        const photo = item.images.find((image) => image.id === item.mainImageId) ?? item.images[0];
        return <li key={item.id}><button type="button" className={styles.card} onClick={() => onView(item)}>
          <span className={styles.photo}>
            {/* Stored photos are resized and optimized on upload. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photo ? <img src={photoUrl(item.id, photo, "candidate")} {...photoSizes(photoUrl(item.id, photo, "candidate"), largeUrl(item.id, photo, "candidate"), photo.widths, CAROUSEL_CARD)} alt="" loading="lazy" decoding="async" width={400} height={300} /> : <Icon size={30} strokeWidth={1.3} aria-hidden="true" />}
          </span>
          <span className={styles.name}>{item.name}</span>
          {item.description && <span className={styles.description}>{item.description}</span>}
          <RestaurantTypeTags types={item.restaurantTypes} className={styles.types} />
          <span className={item.priceCents === null ? styles.price + " " + styles.unknown : styles.price}>{price(item)}</span>
          {item.included && <span className={"selection-tag chosen " + styles.chosen}><Check size={12} aria-hidden="true" />{chosen[category]}</span>}
        </button></li>;
      })}
    </ul>
    <button type="button" className={styles.arrow + " " + styles.next} aria-label={"Next " + name} disabled={!overflows} onClick={() => scroll(1)}><ChevronRight size={20} aria-hidden="true" /></button>
  </div>;
}

/** An idea's details, read only, in its editor's order and words. Its name is the dialog's title. */
export function IdeaDetails({ item }: { item: Candidate }) {
  const category = item.category;
  return <dl className={styles.details}>
    <div><dt>What it is</dt><dd>{item.description || "Not added"}</dd></div>
    {item.restaurantTypes.length > 0 && <div><dt>Restaurant types</dt><dd><RestaurantTypeTags types={item.restaurantTypes} /></dd></div>}
    <div><dt>Estimated price (USD)</dt><dd>{price(item)}<small>{priceNotes[category]}</small></dd></div>
    <div><dt>Address or neighborhood</dt><dd>{item.address || "Not added"}</dd></div>
    <div><dt>Coordinates</dt><dd><CoordinatesDetail coordinates={item.coordinates} /></dd></div>
    <div><dt>{subjects[category]} photos</dt><dd>{item.images.length ? <CandidateGallery candidate={item} frame={DIALOG} /> : "Not added"}</dd></div>
    <div><dt>Website and research links</dt><dd>{item.links.length ? <ResearchLinks links={item.links} /> : "Not added"}</dd></div>
    <div><dt>Notes</dt><dd className="preserve-lines">{item.notes || "Not added"}</dd></div>
    {category !== "hotels" && <div><dt>Must do</dt><dd>{item.mustDo ? "Yes" : "No"}</dd></div>}
    <div><dt>{selectionLabels[category]}</dt><dd>{item.included ? "Yes" : "No"}</dd></div>
  </dl>;
}
