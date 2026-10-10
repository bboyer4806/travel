"use client";

import Link from "next/link";
import LocationField from "@/components/location-field";
import { DestinationImage, DestinationImageEditor } from "@/components/destination-image";
import TripRouteFields from "@/components/trip-route-fields";
import { ConnectionItinerary, ConnectionItineraryEditor } from "@/components/connection-itinerary";
import { ResearchLinks, ResearchLinksEditor } from "@/components/research-links";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BedDouble, Binoculars, CalendarDays, Check, CheckCircle2, Compass, MapPin, MoreHorizontal, Pencil, Plane, Plus, Search, Trash2, Users, Utensils, Wallet, X } from "lucide-react";
import { mutatePlanner } from "@/app/actions";
import { formatSavedDestinationLabel } from "@/lib/destination-label";
import { calculateBudget, formatMoney } from "@/lib/budget";
import type { Budget, Candidate, Category, Destination, ItineraryStop, Mutation, ResearchLink, Snapshot, TravelLeg, Trip } from "@/lib/types";

type Editor =
  | { kind: "trip"; item?: Trip }
  | { kind: "destination"; item?: Destination }
  | { kind: "leg"; item: TravelLeg }
  | { kind: "candidate"; item?: Candidate }
  | { kind: "delete"; mutation: Mutation; title: string; description: string; redirect?: string };
const categories: Category[] = ["hotels", "activities", "restaurants"];
const labels = { hotels: "Hotels", activities: "Activities", restaurants: "Restaurants" };
const singular = { hotels: "hotel", activities: "activity", restaurants: "restaurant" };
const categoryIcons = { hotels: BedDouble, activities: Binoculars, restaurants: Utensils };
const descriptions = {
  hotels: "Find a place to make yourself at home.",
  activities: "Collect the things you would love to do.",
  restaurants: "A good trip deserves a few great meals.",
};
const priceNotes = {
  hotels: "Total for all rooms and the entire stay.",
  activities: "Total for the whole party for this activity.",
  restaurants: "Total for one meal for the whole party.",
};
function destinationImageUrl(destination: Destination) { return "/api/destination-images/" + destination.id + "?v=" + destination.imageVersion; }
function displayPrice(cents: number | null) { return cents === null ? "Not estimated" : formatMoney(cents); }
function priceValue(cents: number | null | undefined) { return cents == null ? "" : (cents / 100).toFixed(2); }
function BudgetValue({ budget }: { budget: Budget }) {
  return <><strong>{budget.knownCount ? formatMoney(budget.totalCents) : "Not estimated"}</strong>
    <span className={budget.complete ? "estimate-status complete" : "estimate-status"}>{budget.complete ? "Estimated total" : budget.knownCount ? "Partial estimate" : "Add a few prices to begin"}</span></>;
}
function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? "field wide" : "field"}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function Notes({ name = "notes", value = "" }: { name?: string; value?: string }) {
  return <Field label="Notes" wide><textarea name={name} defaultValue={value} maxLength={8000} rows={3} placeholder="Anything worth remembering…" /></Field>;
}
function Dialog({ title, children, busy, onClose }: { title: string; children: ReactNode; busy: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null; dialog?.showModal(); return () => { dialog?.close(); if (opener?.isConnected) opener.focus(); }; }, []);
  return <dialog ref={ref} className="editor-dialog" aria-labelledby="editor-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-heading"><h2 id="editor-title">{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose} disabled={busy}><X size={20} /></button></div>{children}
  </dialog>;
}

export default function PlannerApp({ initialData, tripId, destinationId, category }: { initialData: Snapshot; tripId?: string; destinationId?: string; category?: Category }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [lastInitial, setLastInitial] = useState(initialData);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [itinerary, setItinerary] = useState<ItineraryStop[]>([]);
  const [researchLinks, setResearchLinks] = useState<ResearchLink[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  if (lastInitial !== initialData) { setLastInitial(initialData); setData(initialData); }
  const trip = data.trips.find((item) => item.id === tripId);
  const stops = data.destinations.filter((item) => item.tripId === tripId).sort((a, b) => a.position - b.position);
  const destination = stops.find((item) => item.id === destinationId);
  const budget = trip ? calculateBudget(data, trip.id) : null;
  const legName = (id: string | null, end: "from" | "to") => id === null ? (end === "from" ? (trip?.homeCity || "Departing city") : (trip?.returnCity ?? trip?.homeCity) || "Return city") : (formatSavedDestinationLabel(stops.find((stop) => stop.id === id)?.city ?? "") || "Destination");
  const open = (value: Editor) => {
    if (busy) return;
    if (value.kind === "leg") setItinerary(value.item.itinerary ?? []);
    if (value.kind === "leg" || value.kind === "candidate") setResearchLinks(value.item?.links ?? []);
    setImageFile(null); setRemoveImage(false);
    setEditor(value); setError(""); setMessage("");
  };
  const close = () => { if (!busy) { setEditor(null); setError(""); } };
  async function perform(mutation: Mutation, success = "Changes saved.", redirect?: string, imageForm?: FormData) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await mutatePlanner(mutation, imageForm);
      if (!result.ok) { setError(result.error); return; }
      setData(result.snapshot); setEditor(null); setImageFile(null); setMessage(success);
      if (redirect) router.push(redirect);
      else if (mutation.type === "trip.save" && !mutation.id && result.id) router.push("/trips/" + result.id);
    } catch { setError("We couldn't reach the planner. Your changes haven't been saved. Please try again."); }
    finally { setBusy(false); }
  }
  function confirmDelete(mutation: Mutation, title: string, description: string, redirect?: string) {
    open({ kind: "delete", mutation, title, description, redirect });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const fields = new FormData(event.currentTarget);
    const text = (name: string) => String(fields.get(name) ?? "");
    switch (editor.kind) {
      case "delete": void perform(editor.mutation, "Removed from your notebook.", editor.redirect); break;
      case "trip": void perform({ type: "trip.save", id: editor.item?.id, name: text("name"), dateLabel: text("dateLabel"), homeCity: text("homeCity"), returnCity: fields.has("differentReturn") ? text("returnCity") : null, travelers: Number(text("travelers")), notes: text("notes") }); break;
      case "destination": {
        const imageForm = new FormData();
        if (imageFile) imageForm.set("image", imageFile);
        else if (removeImage) imageForm.set("removeImage", "true");
        if (trip) void perform({ type: "destination.save", id: editor.item?.id, tripId: trip.id, city: text("city"), stay: text("stay"), notes: text("notes") }, "Destination saved. Review any new travel connections.", undefined, imageForm);
        break;
      }
      case "leg": void perform({ type: "leg.save", id: editor.item.id, method: text("method"), price: text("price"), departure: text("departure"), arrival: text("arrival"), url: researchLinks[0]?.url ?? "", links: researchLinks, notes: text("notes"), itinerary }); break;
      case "candidate":
        if (destination && category) void perform({ type: "candidate.save", id: editor.item?.id, destinationId: destination.id, category, name: text("name"), price: text("price"), address: text("address"), url: researchLinks[0]?.url ?? "", links: researchLinks, notes: text("notes"), included: fields.has("included") });
        break;
    }
  }
  const pageTitle = editor?.kind === "delete" ? editor.title : editor?.kind === "trip" ? (editor.item ? "Edit trip" : "A new adventure")
    : editor?.kind === "destination" ? (editor.item ? "Edit destination" : "Add a destination")
    : editor?.kind === "leg" ? "Plan this connection"
    : editor?.kind === "candidate" && category ? (editor.item ? "Edit " : "Add a ") + singular[category] : "";
  const visibleTrips = data.trips.filter((item) => [item.name, item.dateLabel, ...data.destinations.filter((stop) => stop.tripId === item.id).flatMap((stop) => [stop.city, formatSavedDestinationLabel(stop.city)])].join(" ").toLowerCase().includes(search.toLowerCase()));

  return <div className="app-shell">
    <header className="site-header"><Link href="/" className="brand"><span className="brand-mark"><Compass size={24} strokeWidth={1.6} /></span><span>travel<span className="brand-dot">.</span></span></Link>
      <nav aria-label="Main navigation"><Link href="/" className={!tripId ? "nav-link active" : "nav-link"}>All trips</Link></nav>
      <span className="shared-label"><span />Shared notebook</span>
    </header>
    <main id="main-content" className="main-content">
      {!tripId && <>
        <section className="home-hero"><div><p className="eyebrow">THE PLACES WE MIGHT GO</p><h1>Somewhere<br /><em>worth going.</em></h1><p className="hero-description">Big adventures, little escapes, and every possibility in between.<br className="desktop-break" /> Give your next idea a place to begin.</p>
          <button className="button primary" onClick={() => open({ kind: "trip" })}><Plus size={18} />New trip</button></div>
          <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><span className="art-n">N</span><Compass className="art-compass" size={132} strokeWidth={0.7} /><span className="art-note">a little room<br />for adventure</span><Plane className="art-plane" size={34} strokeWidth={1.3} /></div>
        </section>
        <section className="trips-section"><div className="section-heading"><div className="heading-inline"><h2>Your possibilities</h2><span className="count-pill">{data.trips.length}</span></div>
          {data.trips.length > 0 && <label className="search-field"><Search size={17} /><input aria-label="Search trips" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a trip or city" /></label>}</div>
          {data.trips.length === 0 ? <div className="empty-state home-empty"><span className="empty-icon"><MapPin size={28} strokeWidth={1.5} /></span><h3>Every trip starts with a possibility.</h3><p>A weekend away? A place you have always wanted to see?<br />Add your first trip and work out the details as you go.</p><button className="button secondary" onClick={() => open({ kind: "trip" })}><Plus size={17} />Create your first trip</button></div>
            : visibleTrips.length === 0 ? <div className="empty-state"><h3>No trips match that search.</h3><button className="text-button" onClick={() => setSearch("")}>Clear search</button></div>
            : <div className="trip-grid">{visibleTrips.map((item, index) => {
              const cities = data.destinations.filter((stop) => stop.tripId === item.id).sort((a, b) => a.position - b.position);
              const estimate = calculateBudget(data, item.id);
              return <article className={"trip-card tone-" + (index % 3)} key={item.id}>
                <Link className="trip-card-main" href={"/trips/" + item.id}><div className="trip-card-top"><span className="trip-number">TRIP {String(index + 1).padStart(2, "0")}</span><Compass size={38} strokeWidth={1} /></div>
                  <h3>{item.name}</h3><p className="city-list"><MapPin size={15} />{cities.length ? cities.map((stop) => formatSavedDestinationLabel(stop.city)).join(" → ") : "Destinations to be decided"}</p>
                  <div className="trip-meta"><span><CalendarDays size={15} />{item.dateLabel || "Whenever the time is right"}</span><span><Users size={15} />{item.travelers} {item.travelers === 1 ? "traveler" : "travelers"}</span></div>
                  <div className="card-budget"><div><span className="small-label">ESTIMATED BUDGET · USD</span><BudgetValue budget={estimate} /></div><span className="round-arrow"><ArrowRight size={19} /></span></div>
                </Link><div className="card-tools"><button className="text-button" aria-label={"Edit " + item.name} onClick={() => open({ kind: "trip", item })}><Pencil size={14} />Edit</button><button className="icon-button muted" aria-label={"Delete " + item.name} onClick={() => confirmDelete({ type: "trip.delete", id: item.id }, "Delete “" + item.name + "”?", "This removes the trip, its destinations, travel plans, and every saved idea.")}><Trash2 size={15} /></button></div>
              </article>;
            })}</div>}
        </section>
      </>}

      {trip && !category && <>
        <Link href="/" className="breadcrumb"><ArrowLeft size={16} />All trips</Link>
        <section className="trip-heading"><div><p className="eyebrow">AN ADVENTURE IN THE MAKING</p><h1>{trip.name}</h1><div className="trip-meta"><span><CalendarDays size={17} />{trip.dateLabel || "Dates to be decided"}</span><span><Users size={17} />{trip.travelers} {trip.travelers === 1 ? "traveler" : "travelers"}</span><span><MapPin size={17} />{trip.homeCity ? "Departing: " + trip.homeCity : "Add departing city"}</span>{trip.returnCity && <span><MapPin size={17} />Returning: {trip.returnCity}</span>}</div>{trip.notes && <p className="trip-notes">{trip.notes}</p>}</div>
          <div className="heading-actions"><button className="button secondary" onClick={() => open({ kind: "trip", item: trip })}><Pencil size={15} />Edit trip</button><button className="icon-button" aria-label="Delete trip" onClick={() => confirmDelete({ type: "trip.delete", id: trip.id }, "Delete this trip?", "“" + trip.name + "” and all its destinations and ideas will be removed.", "/")}><Trash2 size={18} /></button></div>
        </section>
        <div className="trip-layout"><div className="trip-main">
          <section><div className="section-heading"><div><p className="eyebrow">ONE STOP AT A TIME</p><h2>The destinations</h2></div><button className="button secondary small" onClick={() => open({ kind: "destination" })}><Plus size={16} />Add destination</button></div>
            {stops.length === 0 ? <div className="empty-state"><MapPin size={29} strokeWidth={1.4} /><h3>Where should this trip take you?</h3><p>Add your first destination. Your departure and return connections will appear automatically.</p><button className="text-button" onClick={() => open({ kind: "destination" })}>Add a destination <ArrowRight size={16} /></button></div>
              : <div className="destination-list">{stops.map((stop, index) => <article className="destination-card" key={stop.id}>{stop.imageVersion && <DestinationImage src={destinationImageUrl(stop)} name={formatSavedDestinationLabel(stop.city)} />}<div className="destination-top"><span className="stop-number">{String(index + 1).padStart(2, "0")}</span><div className="destination-name"><h3>{formatSavedDestinationLabel(stop.city)}</h3><p>{stop.stay || "Stay length to be decided"}</p></div><div className="destination-tools"><button className="icon-button" disabled={busy || index === 0} aria-label={"Move " + formatSavedDestinationLabel(stop.city) + " up"} onClick={() => void perform({ type: "destination.move", id: stop.id, direction: "up" }, "Route updated. Review the new travel connections.")}><ArrowUp size={15} /></button><button className="icon-button" disabled={busy || index === stops.length - 1} aria-label={"Move " + formatSavedDestinationLabel(stop.city) + " down"} onClick={() => void perform({ type: "destination.move", id: stop.id, direction: "down" }, "Route updated. Review the new travel connections.")}><ArrowDown size={15} /></button><button className="icon-button" aria-label={"Edit " + formatSavedDestinationLabel(stop.city)} onClick={() => open({ kind: "destination", item: stop })}><Pencil size={15} /></button><button className="icon-button" aria-label={"Delete " + formatSavedDestinationLabel(stop.city)} onClick={() => confirmDelete({ type: "destination.delete", id: stop.id }, "Remove “" + formatSavedDestinationLabel(stop.city) + "”?", "Its hotels, activities, restaurants, and affected travel plans will be removed. The remaining route will reconnect.")}><Trash2 size={15} /></button></div></div>
                {stop.notes && <p className="destination-notes">{stop.notes}</p>}
                <div className="category-links">{categories.map((kind) => { const Icon = categoryIcons[kind]; const count = data.candidates.filter((item) => item.destinationId === stop.id && item.category === kind).length; return <Link href={"/trips/" + trip.id + "/destinations/" + stop.id + "/" + kind} key={kind}><Icon size={20} strokeWidth={1.5} /><span>{labels[kind]}<small>{count} {count === 1 ? "idea" : "ideas"}</small></span><ArrowRight size={15} /></Link>; })}</div>
              </article>)}</div>}
            {stops.length > 1 && <p className="helper">Use the arrows to change your route. Affected travel connections will need new details.</p>}
          </section>
          <section className="travel-section"><div className="section-heading"><div><p className="eyebrow">GETTING THERE & BACK</p><h2>Between the places</h2></div><Plane size={25} strokeWidth={1.3} /></div>
            {stops.length === 0 ? <p className="section-description">Your travel connections will appear once you add a destination.</p> : <div className="travel-list">{data.legs.filter((leg) => leg.tripId === trip.id).map((leg) => <article className="travel-card" key={leg.id}><span className="route-dot"><Plane size={16} /></span><div className="travel-content"><h3>{legName(leg.fromId, "from")} <ArrowRight size={15} /> {legName(leg.toId, "to")}</h3><p>{leg.method || "Travel details to be decided"}{leg.departure && " · " + leg.departure}{leg.arrival && " → " + leg.arrival}</p>{leg.notes && <p className="preserve-lines">{leg.notes}</p>}<ResearchLinks links={leg.links ?? []} /><ConnectionItinerary stops={leg.itinerary ?? []} /><span className={leg.priceCents === null ? "price unknown" : "price"}>{displayPrice(leg.priceCents)}{leg.priceCents === null && " · Needs estimate"}</span></div><div className="travel-tools"><button className="text-button" aria-label={"Edit travel from " + legName(leg.fromId, "from") + " to " + legName(leg.toId, "to")} onClick={() => open({ kind: "leg", item: leg })}><Pencil size={14} />Edit</button>{(leg.method || leg.priceCents !== null || leg.notes || leg.url || leg.departure || leg.arrival || (leg.itinerary?.length ?? 0) > 0 || (leg.links?.length ?? 0) > 0) && <button className="text-button muted" onClick={() => confirmDelete({ type: "leg.clear", id: leg.id }, "Clear this travel plan?", "The connection will remain in your route, with its price, travel details, links, and itinerary cleared.")}>Clear</button>}</div></article>)}</div>}
          </section>
        </div>
        {budget && <aside className="budget-panel"><span className="budget-symbol"><Wallet size={23} strokeWidth={1.4} /></span><p className="eyebrow">ROOM IN THE BUDGET</p><h2>The trip estimate</h2><div className="budget-total"><BudgetValue budget={budget} /></div><p className="budget-caption">USD · total for {trip.travelers === 1 ? "1 traveler" : "all " + trip.travelers + " travelers"}</p><dl className="budget-breakdown"><div><dt>Travel</dt><dd>{formatMoney(budget.travelCents)}</dd></div><div><dt>Hotels</dt><dd>{formatMoney(budget.hotelsCents)}</dd></div><div><dt>Activities</dt><dd>{formatMoney(budget.activitiesCents)}</dd></div><div><dt>Restaurants</dt><dd>{formatMoney(budget.restaurantsCents)}</dd></div></dl><div className="budget-note">{budget.complete ? <CheckCircle2 size={17} /> : <MoreHorizontal size={20} />}<p>{budget.complete ? "Every selected item has an estimate." : budget.missingCount + " " + (budget.missingCount === 1 ? "detail still needs" : "details still need") + " an estimate or a choice."}</p></div><p className="helper">Includes travel, one chosen hotel per stop, and the activities and restaurants you select. Unpriced items are excluded from the subtotal.</p></aside>}
        </div>
      </>}

      {trip && destination && category && <>
        <Link href={"/trips/" + trip.id} className="breadcrumb"><ArrowLeft size={16} />{trip.name}</Link>
        <section className="ideas-heading"><div><p className="eyebrow">{formatSavedDestinationLabel(destination.city).toUpperCase()} · THE POSSIBILITIES</p><h1>{labels[category]}</h1><p className="hero-description">{descriptions[category]}</p></div><button className="button primary" onClick={() => open({ kind: "candidate" })}><Plus size={17} />Add {singular[category]}</button></section>
        <nav className="category-tabs" aria-label="Destination ideas">{categories.map((kind) => { const Icon = categoryIcons[kind]; return <Link key={kind} href={"/trips/" + trip.id + "/destinations/" + destination.id + "/" + kind} className={category === kind ? "selected" : ""} aria-current={category === kind ? "page" : undefined}><Icon size={18} />{labels[kind]}<span>{data.candidates.filter((item) => item.destinationId === destination.id && item.category === kind).length}</span></Link>; })}</nav>
        <div className="list-intro"><p>{category === "hotels" ? "Keep your options open. Choose one hotel to include in the budget." : "Save any ideas you like. Include the ones you want in your budget."}</p><span>Prices in USD · whole party</span></div>
        {data.candidates.filter((item) => item.destinationId === destination.id && item.category === category).length === 0 ? <div className="empty-state ideas-empty">{category === "hotels" ? <BedDouble size={34} strokeWidth={1.3} /> : category === "activities" ? <Binoculars size={34} strokeWidth={1.3} /> : <Utensils size={34} strokeWidth={1.3} />}<h3>{category === "hotels" ? "A good night's sleep starts here." : category === "activities" ? "Leave a little room for discovery." : "Something delicious to look forward to."}</h3><p>Save your first {singular[category]} idea for {formatSavedDestinationLabel(destination.city)}.<br />You can add a price now or come back to it later.</p><button className="button secondary" onClick={() => open({ kind: "candidate" })}><Plus size={16} />Add {singular[category]}</button></div>
          : <div className="ideas-grid">{data.candidates.filter((item) => item.destinationId === destination.id && item.category === category).map((item) => <article className={item.included ? "idea-card included" : "idea-card"} key={item.id}><div className="idea-top"><span className={item.included ? "selection-tag chosen" : "selection-tag"}>{item.included ? <><Check size={13} />{category === "hotels" ? "Chosen stay" : "In the plan"}</> : "A possibility"}</span><div className="idea-tools"><button className="icon-button" aria-label={"Edit " + item.name} onClick={() => open({ kind: "candidate", item })}><Pencil size={16} /></button><button className="icon-button" aria-label={"Delete " + item.name} onClick={() => confirmDelete({ type: "candidate.delete", id: item.id }, "Delete “" + item.name + "”?", "This idea will be removed from " + formatSavedDestinationLabel(destination.city) + " and the trip estimate.")}><Trash2 size={16} /></button></div></div><h2>{item.name}</h2>{item.address && <p className="idea-address"><MapPin size={15} />{item.address}</p>}{item.notes && <p className="idea-notes">{item.notes}</p>}<ResearchLinks links={item.links ?? []} /><div className="idea-bottom"><div><span className={item.priceCents === null ? "idea-price unknown" : "idea-price"}>{displayPrice(item.priceCents)}</span><small>{category === "hotels" ? "entire stay · whole party" : category === "restaurants" ? "one meal · whole party" : "whole party"}</small></div><button className={item.included ? "button selected-button small" : "button secondary small"} disabled={busy} aria-pressed={item.included} onClick={() => void perform({ type: "candidate.include", id: item.id, included: !item.included }, "Trip estimate updated.")}>{item.included ? <><Check size={15} />Included</> : category === "hotels" ? "Choose hotel" : "Include in budget"}</button></div></article>)}</div>}
      </>}
      {!trip && tripId && <div className="empty-state"><h1>This trip is no longer here.</h1><Link href="/">Back to all trips</Link></div>}
      {message && <div className="toast" role="status"><CheckCircle2 size={17} />{message}<button aria-label="Dismiss message" className="icon-button" onClick={() => setMessage("")}><X size={14} /></button></div>}
      {error && !editor && <div role="alert" className="error-banner">{error}</div>}
    </main>
    <footer className="site-footer"><span><Compass size={15} />For the trips still taking shape.</span><span>Shared editing · USD estimates</span></footer>
    {editor && <Dialog title={pageTitle} busy={busy} onClose={close}><form onSubmit={submit}><div className="form-grid">
      {editor.kind === "delete" && <p className="delete-description wide">{editor.description} This cannot be undone.</p>}
      {editor.kind === "trip" && <>
        <Field label="Trip name" wide><input name="name" defaultValue={editor.item?.name} required maxLength={120} placeholder="A long weekend in the mountains" autoFocus /></Field>
        <Field label="General date" hint="Exact dates can wait."><input name="dateLabel" defaultValue={editor.item?.dateLabel} maxLength={120} placeholder="Spring 2027, or sometime soon" /></Field>
        <Field label="Travelers"><input name="travelers" type="number" min="1" max="999" step="1" required defaultValue={editor.item?.travelers ?? 2} /></Field>
        <TripRouteFields trip={editor.item} disabled={busy} /><Notes value={editor.item?.notes} />
      </>}
      {editor.kind === "destination" && <>
        <LocationField compactDestination label="City or destination" name="city" defaultValue={editor.item?.city} required autoFocus disabled={busy} placeholder="Start typing a city, e.g. Vienna" helpText="Choose a suggestion or enter any destination." hint={editor.item ? "Changing the city clears travel details for its incoming and outgoing connections." : undefined} />
        <Field label="Dates or length of stay" wide><input name="stay" defaultValue={editor.item?.stay} maxLength={120} placeholder="3 nights, or May 12–15" /></Field>
        <DestinationImageEditor existingSrc={editor.item?.imageVersion ? destinationImageUrl(editor.item) : null} file={imageFile} removeExisting={removeImage} onChange={(file, remove) => { setImageFile(file); setRemoveImage(remove); }} disabled={busy} />
        <Notes value={editor.item?.notes} />
      </>}
      {editor.kind === "leg" && <>
        <p className="form-route wide">{legName(editor.item.fromId, "from")} <ArrowRight size={16} /> {legName(editor.item.toId, "to")}</p>
        <Field label="Transportation" wide><input name="method" defaultValue={editor.item.method} maxLength={120} autoFocus placeholder="Flight, train, rental car…" /></Field>
        <Field label="Estimated price (USD)" wide hint="Total for the whole party for the full connection, including itinerary stops. Leave blank if unknown."><input name="price" type="number" min="0" max="100000000" step="0.01" defaultValue={priceValue(editor.item.priceCents)} placeholder="Not estimated" /></Field>
        <Field label="Departure"><input name="departure" defaultValue={editor.item.departure} maxLength={120} placeholder="Date, time, or general plan" /></Field>
        <Field label="Arrival"><input name="arrival" defaultValue={editor.item.arrival} maxLength={120} placeholder="Date, time, or general plan" /></Field>
        <ResearchLinksEditor links={researchLinks} onChange={setResearchLinks} disabled={busy} /><Notes value={editor.item.notes} />
        <ConnectionItineraryEditor stops={itinerary} onChange={setItinerary} disabled={busy} />
      </>}
      {editor.kind === "candidate" && category && <>
        <Field label="Name" wide><input name="name" defaultValue={editor.item?.name} required maxLength={160} autoFocus placeholder={"Name of the " + singular[category]} /></Field>
        <Field label="Estimated price (USD)" wide hint={priceNotes[category] + " Leave blank if unknown."}><input name="price" type="number" min="0" max="100000000" step="0.01" defaultValue={priceValue(editor.item?.priceCents)} placeholder="Not estimated" /></Field>
        <Field label="Address or neighborhood" wide><input name="address" defaultValue={editor.item?.address} maxLength={500} placeholder="Optional" /></Field>
        <ResearchLinksEditor links={researchLinks} onChange={setResearchLinks} disabled={busy} /><Notes value={editor.item?.notes} />
        <label className="checkbox-field wide"><input name="included" type="checkbox" defaultChecked={editor.item?.included ?? false} /><span>{category === "hotels" ? "Choose this hotel for the budget" : "Include in budget"}<small>{category === "hotels" ? "Replaces any other chosen hotel for this destination." : "You can change this as your plans take shape."}</small></span></label>
      </>}
    </div>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button secondary" onClick={close} disabled={busy}>Cancel</button><button className={editor.kind === "delete" ? "button danger" : "button primary"} type="submit" disabled={busy}>{busy ? "Saving…" : editor.kind === "delete" ? (editor.mutation.type === "leg.clear" ? "Clear travel plan" : "Delete") : editor.kind === "trip" && !editor.item ? "Create trip" : "Save changes"}</button></div></form></Dialog>}
  </div>;
}
