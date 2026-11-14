"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { BedDouble, Binoculars, Check, ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, Utensils } from "lucide-react";
import { CandidateGallery, photoUrl } from "./candidate-gallery";
import { ResearchLinks } from "./research-links";
import { formatCurrency } from "@/lib/money";
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
      {ideas.length ? <Carousel category={category} ideas={[...ideas.filter((item) => item.included), ...ideas.filter((item) => !item.included)]} onView={onView} />
        : <p className={styles.empty}>No {name.toLowerCase()} saved yet.</p>}
      <Link className={"text-button " + styles.manage} href={href}>Manage {name.toLowerCase()}<span className="sr-only"> in {city}</span></Link>
    </div>
  </section>;
}

/** One card per idea, scrolled sideways by its arrows, or by swiping or scrolling. */
function Carousel({ category, ideas, onView }: { category: Category; ideas: Candidate[]; onView: (item: Candidate) => void }) {
  const track = useRef<HTMLUListElement>(null);
  // Each arrow works while there is more to see its way. Until the list is measured, neither does.
  const [edges, setEdges] = useState({ start: true, end: true });
  useEffect(() => {
    const list = track.current;
    if (!list) return;
    const measure = () => {
      const start = list.scrollLeft <= 1;
      const end = list.scrollLeft + list.clientWidth >= list.scrollWidth - 1;
      setEdges((current) => current.start === start && current.end === end ? current : { start, end });
    };
    // A new observer measures once when it starts, then whenever the list resizes, as when its section opens.
    const resizing = new ResizeObserver(measure);
    resizing.observe(list);
    list.addEventListener("scroll", measure, { passive: true });
    return () => { resizing.disconnect(); list.removeEventListener("scroll", measure); };
  }, [ideas.length]);
  const scroll = (direction: -1 | 1) => { const list = track.current; list?.scrollBy({ left: direction * list.clientWidth }); };
  const Icon = icons[category];
  const name = labels[category].toLowerCase();
  return <div className={styles.carousel}>
    <button type="button" className={styles.arrow + " " + styles.previous} aria-label={"Previous " + name} disabled={edges.start} onClick={() => scroll(-1)}><ChevronLeft size={20} aria-hidden="true" /></button>
    <ul ref={track} className={styles.track}>
      {ideas.map((item) => {
        const photo = item.images.find((image) => image.id === item.mainImageId) ?? item.images[0];
        return <li key={item.id}><button type="button" className={styles.card} onClick={() => onView(item)}>
          <span className={styles.photo}>
            {/* Stored photos are resized and optimized on upload. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photo ? <img src={photoUrl(item.id, photo, "candidate")} alt="" loading="lazy" decoding="async" width={400} height={300} /> : <Icon size={30} strokeWidth={1.3} aria-hidden="true" />}
          </span>
          <span className={styles.name}>{item.name}</span>
          <span className={item.priceCents === null ? styles.price + " " + styles.unknown : styles.price}>{price(item)}</span>
          {item.included && <span className={"selection-tag chosen " + styles.chosen}><Check size={12} aria-hidden="true" />{chosen[category]}</span>}
        </button></li>;
      })}
    </ul>
    <button type="button" className={styles.arrow + " " + styles.next} aria-label={"Next " + name} disabled={edges.end} onClick={() => scroll(1)}><ChevronRight size={20} aria-hidden="true" /></button>
  </div>;
}

/** An idea's details, read only, in its editor's order and words. Its name is the dialog's title. */
export function IdeaDetails({ item }: { item: Candidate }) {
  const category = item.category;
  return <dl className={styles.details}>
    <div><dt>Estimated price (USD)</dt><dd>{price(item)}<small>{priceNotes[category]}</small></dd></div>
    <div><dt>Address or neighborhood</dt><dd>{item.address || "Not added"}</dd></div>
    <div><dt>{subjects[category]} photos</dt><dd>{item.images.length ? <CandidateGallery candidate={item} /> : "Not added"}</dd></div>
    <div><dt>Website and research links</dt><dd>{item.links.length ? <ResearchLinks links={item.links} /> : "Not added"}</dd></div>
    <div><dt>Notes</dt><dd className="preserve-lines">{item.notes || "Not added"}</dd></div>
    {category !== "hotels" && <div><dt>Must do</dt><dd>{item.mustDo ? "Yes" : "No"}</dd></div>}
    <div><dt>{selectionLabels[category]}</dt><dd>{item.included ? "Yes" : "No"}</dd></div>
  </dl>;
}
