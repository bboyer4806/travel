"use client";

import Link from "next/link";
import { FeedbackButton } from "@/components/feedback";
import { churchDateEligible, formatCalendarDate } from "@/lib/trip-dates";
import LocationField from "@/components/location-field";
import HomeItems from "@/components/home-items";
import { ChurchSundays } from "@/components/church-sundays";
import { EntryRequirementsPanel, EntryRequirementsEditor } from "@/components/entry-requirements";
import { entryRequirementsFromForm } from "@/lib/entry-requirements";
import { HealthSafetyPanel, HealthSafetyEditor } from "@/components/health-safety";
import { healthSafetyFromForm, type EmergencyContact } from "@/lib/health-safety";
import { ChurchOptions, ChurchEditor } from "@/components/churches";
import { TypicalWeatherPanel, TypicalWeatherEditor } from "@/components/typical-weather";
import { DestinationGallery, DestinationGalleryEditor, createDestinationGalleryDraft, destinationGalleryForm, type DestinationGalleryDraft } from "@/components/destination-gallery";
import CandidateList from "@/components/candidate-list";
import { CandidateGalleryEditor, candidateGalleryForm, createCandidateGalleryDraft, type CandidateGalleryDraft } from "@/components/candidate-gallery";
import TripRouteFields from "@/components/trip-route-fields";
import { ConnectionItinerary, ConnectionItineraryEditor } from "@/components/connection-itinerary";
import { ResearchLinks, ResearchLinksEditor } from "@/components/research-links";
import { unstable_isUnrecognizedActionError, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BedDouble, Bike, Binoculars, Bus, CalendarDays, Car, CheckCircle2, CircleAlert, Compass, Footprints, MapPin, MoreHorizontal, Pencil, Plane, Plus, Route, Search, Share2, Ship, TrainFront, Trash2, UserPlus, Users, Utensils, Wallet, X, type LucideIcon } from "lucide-react";
import TripSharing, { memberLabel } from "@/components/trip-sharing";
import { TripTagFilter, TripTagList, TripTagsEditor } from "@/components/trip-tags";
import { hasEveryTag, tagKey } from "@/lib/trip-tags";
import { mutatePlanner } from "@/app/actions";
import { randomUuid } from "@/lib/uuid";
import { PLANNER_UPDATED } from "@/lib/planner-updated";
import { formatSavedDestinationLabel } from "@/lib/destination-label";
import { transportationIcons, type TransportationIcon } from "@/lib/transportation-methods";
import { calculateBudget, calculateDestinationBudget, tripVisits } from "@/lib/budget";
import { formatCurrency, MAX_AMOUNT_DOLLARS, minorAmountValue } from "@/lib/money";
import { ShoppingBudgetEditor, FoodBudgetEditor, FoodSummary, ActivitiesBudgetEditor, ActivitiesSummary, AccommodationBudgetEditor, AccommodationSummary, CurrencyTotals, DestinationBudget, DestinationBudgetEditor, MiscellaneousBudgetEditor, StayNightsEditor } from "@/components/destination-budget";
import type { FoodBudgetMode, ActivitiesBudgetMode, Budget, Candidate, Church, MassTime, Category, Destination, DestinationAccess, DestinationVisit, HomeItem, ItineraryStop, Mutation, ResearchLink, Snapshot, TravelLeg, Trip, TripAccess, TripStop } from "@/lib/types";

type Editor =
  | { kind: "trip"; item?: Trip }
  // A saved destination; with a stop it also edits that trip's stay.
  | { kind: "destination"; item: Destination; stop?: TripStop }
  // A city to add to the trip. Only the city is asked for.
  | { kind: "addStop" }
  // A destination outside any trip, from Destinations. Only its city is asked for.
  | { kind: "newDestination" }
  | { kind: "shoppingBudget"; item: Destination }
  // Accommodation's nightly estimate, and with a stop that trip's nights there.
  | { kind: "accommodationBudget"; item: Destination; stop?: TripStop }
  | { kind: "miscellaneousBudget"; item: Destination; nights: number | null }
  // One trip's nights at a destination.
  | { kind: "stayNights"; stop: TripStop }
  | { kind: "weather"; item: Destination }
  | { kind: "entryRequirements"; item: Destination }
  | { kind: "healthSafety"; item: Destination }
  | { kind: "activitiesBudget"; item: Destination }
  | { kind: "foodBudget"; item: Destination; nights: number | null }
  | { kind: "leg"; item: TravelLeg }
  | { kind: "candidate"; item?: Candidate }
  | { kind: "church"; destinationId: string; item?: Church }
  | { kind: "homeItem"; item?: HomeItem }
  | { kind: "share" }
  | { kind: "delete"; mutation: Mutation; title: string; description: string; redirect?: string };
const categories: Category[] = ["hotels", "activities", "restaurants"];
const labels = { hotels: "Hotels", activities: "Activities", restaurants: "Restaurants" };
const singular = { hotels: "hotel", activities: "activity", restaurants: "restaurant" } as const;
const categoryIcons = { hotels: BedDouble, activities: Binoculars, restaurants: Utensils };
const transportation: Record<TransportationIcon, { Icon: LucideIcon; label: string }> = {
  airplane: { Icon: Plane, label: "Airplane" },
  train: { Icon: TrainFront, label: "Train" },
  car: { Icon: Car, label: "Car" },
  bus: { Icon: Bus, label: "Bus" },
  boat: { Icon: Ship, label: "Boat" },
  walking: { Icon: Footprints, label: "Walking" },
  bicycle: { Icon: Bike, label: "Bicycle" },
  route: { Icon: Route, label: "Unknown transportation" },
};
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
function displayPrice(cents: number | null) { return cents === null ? "Not estimated" : formatCurrency(cents, "USD"); }
function BudgetValue({ budget }: { budget: Budget }) {
  return <><strong>{<CurrencyTotals totals={budget.totalsByCurrency} />}</strong>
    <span className={budget.complete ? "estimate-status complete" : "estimate-status"}>{budget.complete ? "Estimated total" : budget.knownCount ? "Partial estimate" : "Add a few prices to begin"}</span></>;
}
/** A connection's icons: one for each kind of transportation its saved text names, in the order entered. */
function TransportationIcons({ method }: { method: string }) {
  const icons = transportationIcons(method);
  return <span className="route-dot" role="img" aria-label={icons.map((icon) => transportation[icon].label).join(", ")}>
    {icons.map((icon) => { const { Icon } = transportation[icon]; return <Icon key={icon} size={16} aria-hidden="true" />; })}</span>;
}
function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? "field wide" : "field"}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function Notes({ name = "notes", value = "" }: { name?: string; value?: string }) {
  return <Field label="Notes" wide><textarea name={name} defaultValue={value} maxLength={8000} rows={3} placeholder="Anything worth remembering…" /></Field>;
}
/**
 * An editor: the title and X at the top, then `children`, a form whose fields scroll above its Cancel and Save footer.
 * Opening it focuses its first field. Editors don't use `autoFocus`: React runs it before `showModal()`, while the fields can't take focus.
 * Send feedback is inside the dialog so it shows above the backdrop; opening it leaves this editor and its draft open.
 */
function Dialog({ title, children, busy, onClose }: { title: string; children: ReactNode; busy: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null; dialog?.showModal(); dialog?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")?.focus(); return () => { dialog?.close(); if (opener?.isConnected) opener.focus(); }; }, []);
  return <dialog ref={ref} className="editor-dialog" aria-labelledby="editor-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-heading"><h2 id="editor-title">{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose} disabled={busy}><X size={20} /></button></div>{children}<FeedbackButton />
  </dialog>;
}

function count(value: number, one: string, many: string) { return value + " " + (value === 1 ? one : many); }

/** Deleting a shared trip removes it for everyone it was shared with, so its confirmation says so. */
function sharedDeleteNote(access: TripAccess): string {
  return access.role === "owner" && access.sharedWith.length > 0 ? " Everyone you shared it with will lose it too." : "";
}

/**
 * Every planner page: the trip list (no IDs), a trip (`tripId`) and its idea pages (with `stopId`), and Destinations:
 * the list (`destinationList`), one destination (`destinationId`) and its idea pages. Idea pages name a `category`, or `church`.
 */
export default function PlannerApp({ initialData, initialBudgets, access = {}, destinationAccess = {}, tripId, stopId, destinationId, category, church = false, destinationList = false }: { initialData: Snapshot; initialBudgets?: Record<string, Budget>; access?: Record<string, TripAccess>; destinationAccess?: Record<string, DestinationAccess>; tripId?: string; stopId?: string; destinationId?: string; category?: Category; church?: boolean; destinationList?: boolean }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [lastInitial, setLastInitial] = useState(initialData);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [itinerary, setItinerary] = useState<ItineraryStop[]>([]);
  const [massTimes, setMassTimes] = useState<MassTime[]>([]);
  const [researchLinks, setResearchLinks] = useState<ResearchLink[]>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [destinationGallery, setDestinationGallery] = useState<DestinationGalleryDraft>(() => createDestinationGalleryDraft());
  const [candidateGallery, setCandidateGallery] = useState<CandidateGalleryDraft>(() => createCandidateGalleryDraft());
  // The ID of the item an editor adds, given once when it opens, so saving again after a response is lost changes that item instead of adding another.
  const [newId, setNewId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  // The trip list's selected tag filters, as tag keys.
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  // A stop to scroll to once the page shows it, after adding its city. This scrolls instead of navigating to its
  // #destination- link: after a Server Action, Next.js 16.4 adds that hash to any the URL already has.
  const shownStop = useRef<string | null>(null);
  useEffect(() => {
    const card = shownStop.current === null ? null : document.getElementById("destination-" + shownStop.current);
    if (card) { shownStop.current = null; card.scrollIntoView(); }
  });
  // A save's message closes itself after five seconds. An error stays until it is dismissed or another change starts (TRA-82).
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 5_000);
    return () => clearTimeout(timer);
  }, [message]);
  if (lastInitial !== initialData) { setLastInitial(initialData); setData(initialData); }
  const trip = data.trips.find((item) => item.id === tripId);
  // Only owners see Share and Delete; the server refuses those changes from anyone else.
  const tripAccess = trip ? access[trip.id] : undefined;
  // A trip's stops in route order. A trip's idea page loads only its own stop's destination, so only the trip page has every visit.
  const stops = data.stops.filter((item) => item.tripId === tripId).sort((a, b) => a.position - b.position);
  const visits = trip && !stopId ? tripVisits(data, trip.id) : [];
  const stop = stops.find((item) => item.id === stopId);
  // The destination this page is about: a trip stop's, or one opened from Destinations.
  const destination = data.destinations.find((item) => item.id === (tripId ? stop?.destinationId : destinationId));
  const tripLegs = data.legs.filter((leg) => leg.tripId === tripId);
  const budget = trip && !stopId ? calculateBudget(data, trip.id) : null;
  const homeBudgets = initialBudgets ?? {};
  const cityOf = (destinationIdValue: string) => data.destinations.find((item) => item.id === destinationIdValue)?.city ?? "";
  /** A destination's selected hotel, whose whole-stay price replaces its general nightly estimate. */
  const selectedHotel = (destinationIdValue?: string) => data.candidates.find((item) => item.destinationId === destinationIdValue && item.category === "hotels" && item.included);
  const tripCities = (id: string) => data.stops.filter((item) => item.tripId === id).sort((a, b) => a.position - b.position).map((item) => cityOf(item.destinationId));
  const legName = (id: string | null, end: "from" | "to") => id === null ? (end === "from" ? (trip?.homeCity || "Departing city") : (trip?.returnCity ?? trip?.homeCity) || "Return city") : (formatSavedDestinationLabel(cityOf(stops.find((item) => item.id === id)?.destinationId ?? "")) || "Destination");
  /** The trips this account can open that visit a destination, with their stops there. */
  const visitsOf = (id: string) => data.stops.filter((item) => item.destinationId === id).flatMap((item) => data.trips.filter((visiting) => visiting.id === item.tripId).map((visiting) => ({ trip: visiting, stop: item })));
  const open = (value: Editor) => {
    if (busy) return;
    if (value.kind === "leg") setItinerary(value.item.itinerary ?? []);
    if (value.kind === "leg" || value.kind === "candidate") setResearchLinks(value.item?.links ?? []);
    if (value.kind === "entryRequirements") setResearchLinks(value.item.entryRequirements?.sources ?? []);
    if (value.kind === "healthSafety") { setResearchLinks(value.item.healthSafety?.sources ?? []); setEmergencyContacts(value.item.healthSafety?.emergencyContacts ?? []); }
    if (value.kind === "church") setMassTimes(value.item?.massTimes ?? []);
    setDestinationGallery(createDestinationGalleryDraft(value.kind === "destination" ? value.item : undefined));
    setCandidateGallery(createCandidateGalleryDraft(value.kind === "candidate" || value.kind === "church" ? value.item : undefined));
    setNewId(randomUuid());
    setEditor(value); setError(""); setMessage("");
  };
  /** The item a save is for: the saved one an editor changes, or the new one it adds. */
  const itemToSave = (item?: { id: string }) => item ? { id: item.id } : { id: newId, create: true as const };
  const close = () => { if (!busy) { setEditor(null); setDestinationGallery(createDestinationGalleryDraft()); setCandidateGallery(createCandidateGalleryDraft()); setError(""); } };
  /** Saves a change and refreshes the page, resolving to whether it was saved. A refused change shows its error. */
  async function perform(mutation: Mutation, success = "Changes saved.", redirect?: string, imageForm?: FormData): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await mutatePlanner(mutation, imageForm);
      if (!result.ok) { setError(result.error); return false; }
      setEditor(null); setDestinationGallery(createDestinationGalleryDraft()); setCandidateGallery(createCandidateGalleryDraft()); setMessage(success);
      if (mutation.type === "stop.add" && result.id) {
        // The trip's stop for the city: the one added, or the one it already had, which opens instead.
        const visiting = stops.find((item) => item.id === result.id);
        if (visiting) setMessage("“" + formatSavedDestinationLabel(cityOf(visiting.destinationId)) + "” is already in this trip.");
        shownStop.current = result.id;
      }
      if (redirect) router.push(redirect);
      else if (mutation.type === "trip.save" && mutation.create) router.push("/trips/" + mutation.id);
      else if (mutation.type === "destination.create" && result.id) router.push("/destinations/" + result.id);
      else router.refresh();
      return true;
    } catch (failure) {
      // A page opened before a deploy whose build changed the save action's ID: retrying never works, reloading does.
      setError(unstable_isUnrecognizedActionError(failure) ? PLANNER_UPDATED : "We couldn't confirm that your changes were saved. Please try again.");
      return false;
    }
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
    const nights = text("nights") === "" ? null : Number(text("nights"));
    switch (editor.kind) {
      case "delete": void perform(editor.mutation, "Removed from your notebook.", editor.redirect); break;
      case "trip": void perform({ type: "trip.save", ...itemToSave(editor.item), name: text("name"), startDate: text("startDate") || null, dateLabel: text("dateLabel"), homeCity: text("homeCity"), returnCity: fields.has("differentReturn") ? text("returnCity") : null, travelers: Number(text("travelers")), notes: text("notes") }); break;
      case "entryRequirements": {
        void perform({ type: "destination.entryRequirements", id: editor.item.id, requirements: entryRequirementsFromForm(fields, researchLinks) }, "Entry requirements saved.");
        break;
      }
      case "healthSafety": {
        void perform({ type: "destination.healthSafety", id: editor.item.id, healthSafety: healthSafetyFromForm(fields, emergencyContacts, researchLinks) }, "Health and safety saved.");
        break;
      }
      case "weather": {
        const item = editor.item;
        void perform({ type: "destination.save", id: item.id,
          weatherHighF: text("weatherHighF").trim() === "" ? null : Number(text("weatherHighF")),
          weatherLowF: text("weatherLowF").trim() === "" ? null : Number(text("weatherLowF")),
          weatherPeriod: text("weatherPeriod"), weatherRainfall: text("weatherRainfall"), weatherSource: text("weatherSource") }, "Typical weather saved.");
        break;
      }
      case "destination": {
        const imageForm = destinationGalleryForm(destinationGallery, editor.item);
        const shared = { city: text("city"), notes: text("notes"), miscDailyAmount: text("miscDailyAmount"), hotelNightlyAmount: text("hotelNightlyAmount"), activitiesBudgetMode: text("activitiesBudgetMode") as ActivitiesBudgetMode, activitiesGeneralAmount: text("activitiesGeneralAmount"), foodBudgetMode: text("foodBudgetMode") as FoodBudgetMode, foodDailyAmount: text("foodDailyAmount"), shoppingAmount: text("shoppingAmount") };
        const stay = { stay: text("stay"), nights };
        if (editor.stop) void perform({ type: "destination.save", id: editor.item.id, stopId: editor.stop.id, ...shared, ...stay }, "Destination saved. Review any new travel connections.", undefined, imageForm);
        else void perform({ type: "destination.save", id: editor.item.id, ...shared }, "Destination saved in every trip that visits it.", undefined, imageForm);
        break;
      }
      case "addStop": if (trip) void perform({ type: "stop.add", tripId: trip.id, city: text("city") }, "Destination added. Review any new travel connections."); break;
      case "newDestination": void perform({ type: "destination.create", city: text("city") }); break;
      case "shoppingBudget": {
        const item = editor.item;
        void perform({ type: "destination.save", id: item.id, shoppingAmount: text("shoppingAmount") }, "Shopping budget saved.");
        break;
      }
      case "accommodationBudget": {
        const hotelNightlyAmount = text("hotelNightlyAmount");
        if (editor.stop) void perform({ type: "destination.save", id: editor.item.id, stopId: editor.stop.id, nights, hotelNightlyAmount }, "Accommodation budget saved.");
        else void perform({ type: "destination.save", id: editor.item.id, hotelNightlyAmount }, "Accommodation budget saved.");
        break;
      }
      case "miscellaneousBudget": void perform({ type: "destination.save", id: editor.item.id, miscDailyAmount: text("miscDailyAmount") }, "Miscellaneous budget saved."); break;
      case "stayNights": void perform({ type: "destination.save", id: editor.stop.destinationId, stopId: editor.stop.id, nights }, "Nights saved."); break;
      case "foodBudget": {
        const item = editor.item;
        void perform({ type: "destination.save", id: item.id, foodBudgetMode: text("foodBudgetMode") as FoodBudgetMode, foodDailyAmount: text("foodDailyAmount") }, "Food budget saved.");
        break;
      }
      case "activitiesBudget": {
        const item = editor.item;
        void perform({ type: "destination.save", id: item.id, activitiesBudgetMode: text("activitiesBudgetMode") as ActivitiesBudgetMode, activitiesGeneralAmount: text("activitiesGeneralAmount") }, "Activities budget saved.");
        break;
      }
      case "homeItem": {
        if (trip) void perform({ type: "homeItem.save", ...itemToSave(editor.item), tripId: trip.id, name: text("name"), price: text("price"), notes: text("notes"), completed: fields.has("completed") }, "At home item saved.");
        break;
      }
      case "share": {
        if (trip) void perform({ type: "trip.share", tripId: trip.id, email: text("email") }, "Shared with " + text("email").trim().toLowerCase() + ". Travel doesn't send email, so let them know.");
        break;
      }
      case "leg": void perform({ type: "leg.save", id: editor.item.id, method: text("method"), price: text("price"), departure: text("departure"), arrival: text("arrival"), url: researchLinks[0]?.url ?? "", links: researchLinks, notes: text("notes"), itinerary }); break;
      case "church": {
        void perform({ type: "church.save", ...itemToSave(editor.item), destinationId: editor.destinationId, name: text("name"), address: text("address"), denomination: text("denomination"), url: text("url"), massTimes }, "Church saved.", undefined, candidateGalleryForm(candidateGallery, editor.item));
        break;
      }
      case "candidate": {
        const imageForm = candidateGalleryForm(candidateGallery, editor.item);
        if (destination && category) void perform({ type: "candidate.save", ...itemToSave(editor.item), destinationId: destination.id, category, name: text("name"), price: text("price"), address: text("address"), url: researchLinks[0]?.url ?? "", links: researchLinks, notes: text("notes"), included: fields.has("included"), mustDo: fields.has("mustDo") }, "Changes saved.", undefined, imageForm);
        break;
      }
    }
  }
  const pageTitle = editor?.kind === "delete" ? editor.title : editor?.kind === "trip" ? (editor.item ? "Edit trip" : "A new adventure")
    : editor?.kind === "church" ? (editor.item ? "Edit church" : "Add a church")
    : editor?.kind === "entryRequirements" ? "Edit entry requirements"
    : editor?.kind === "healthSafety" ? "Edit health and safety"
    : editor?.kind === "weather" ? "Edit typical weather"
    : editor?.kind === "destination" ? "Edit destination: " + formatSavedDestinationLabel(editor.item.city)
    : editor?.kind === "addStop" ? "Add a destination"
    : editor?.kind === "newDestination" ? "New destination"
    : editor?.kind === "shoppingBudget" ? "Edit shopping budget"
    : editor?.kind === "accommodationBudget" ? "Edit accommodation budget"
    : editor?.kind === "miscellaneousBudget" ? "Edit miscellaneous budget"
    : editor?.kind === "stayNights" ? "Edit destination nights"
    : editor?.kind === "foodBudget" ? "Edit food budget"
    : editor?.kind === "activitiesBudget" ? "Edit activities budget"
    : editor?.kind === "leg" ? "Plan this connection"
    : editor?.kind === "homeItem" ? (editor.item ? "Edit home item" : "Add an item at home")
    : editor?.kind === "share" ? "Share this trip"
    : editor?.kind === "candidate" && category ? (editor.item ? "Edit " : category === "activities" ? "Add " : "Add a ") + singular[category] : "";
  /** A destination's Church section. In a trip, that stay's dates decide whether it can appear and which Sundays it lists. */
  function renderChurch(place: Destination, stay?: TripStop) {
    if (stay && !churchDateEligible(stay)) return null;
    if (!place.churchEnabled) return <div className="church-visibility"><p className="helper">Church is hidden. Saved churches and photos are kept.</p><button type="button" className="text-button" disabled={busy} onClick={() => void perform({ type: "destination.churchVisibility", id: place.id, enabled: true }, "Church shown.")}>Show Church<span className="sr-only"> for {place.city}</span></button></div>;
    return <section className="destination-church" aria-label={"Church in " + place.city}><div className="budget-section-heading"><h4>Church</h4><div className="heading-actions"><button type="button" className="text-button" disabled={busy} onClick={() => open({ kind: "church", destinationId: place.id })}><Plus size={15} />Add church</button><button type="button" className="text-button" disabled={busy} onClick={() => void perform({ type: "destination.churchVisibility", id: place.id, enabled: false }, "Church hidden. Your churches and photos are saved.")}>Hide Church</button></div></div>
      {stay && <ChurchSundays destination={stay} />}
      <ChurchOptions items={data.churches.filter((item) => item.destinationId === place.id)} busy={busy} onAdd={() => open({ kind: "church", destinationId: place.id })} onEdit={(item) => open({ kind: "church", item, destinationId: place.id })} onDelete={(item) => confirmDelete({ type: "church.delete", id: item.id, destinationId: place.id }, "Delete “" + item.name + "”?", "This church and its photos will be removed from this destination, in every trip that visits it.")} />
    </section>;
  }
  /** A destination's Hotels, Activities, Restaurants or Church page, from a trip's stop or from Destinations. */
  function renderIdeas(place: Destination, stay: TripStop | undefined, back: { href: string; label: string }) {
    const visit: DestinationVisit = { ...place, nights: stay?.nights ?? null };
    const pages = stay ? "/trips/" + stay.tripId + "/destinations/" + stay.id : "/destinations/" + place.id;
    const label = formatSavedDestinationLabel(place.city);
    return <>
      <Link href={back.href} className="breadcrumb"><ArrowLeft size={16} />{back.label}</Link>
      <section className="ideas-heading"><div><p className="eyebrow">{label.toUpperCase()} · THE POSSIBILITIES</p><h1>{category ? labels[category] : "Church"}</h1><p className="hero-description">{category ? descriptions[category] : "Keep church options and Mass times for your visit."}</p></div>{!category && place.churchEnabled && (!stay || churchDateEligible(stay)) && <button className="button primary" disabled={busy} onClick={() => open({ kind: "church", destinationId: place.id })}><Plus size={17} />Add church</button>}</section>
      <nav className="category-tabs" aria-label="Destination ideas">{categories.map((kind) => { const Icon = categoryIcons[kind]; return <Link key={kind} href={pages + "/" + kind} className={category === kind ? "selected" : ""} aria-current={category === kind ? "page" : undefined}><Icon size={18} />{labels[kind]}<span>{data.candidates.filter((item) => item.destinationId === place.id && item.category === kind).length}</span></Link>; })}</nav>
      {church && <><p className="helper">{stay ? "Church plans are managed on this destination’s trip card." : "Church plans are managed on this destination’s page."} Mass times are manually recorded and have not been verified.</p>{renderChurch(place, stay)}{stay && !churchDateEligible(stay) && <p className="helper">This stay does not include Sunday. Saved churches and photos are kept for future plans.</p>}</>}
      {category && <>
      {category === "hotels" && <section className="hotel-budget-panel" aria-label="Accommodation budget"><div className="section-heading"><h2>Accommodation budget</h2><button className="button secondary small" onClick={() => open({ kind: "accommodationBudget", item: place, stop: stay })}><Pencil size={15} />{stay ? "Edit estimate & nights" : "Edit nightly estimate"}</button></div><AccommodationSummary snapshot={data} destination={visit} /></section>}
      {category === "activities" && <section className="hotel-budget-panel" aria-label="Activities budget"><div className="section-heading"><h2>Activities budget</h2><button className="button secondary small" onClick={() => open({ kind: "activitiesBudget", item: place })}><Pencil size={15} />Edit activities budget</button></div><ActivitiesSummary snapshot={data} destination={place} /><p className="helper">{place.activitiesBudgetMode === "general" ? "Your general amount supplies the budget. Activity selections are saved for itemized mode." : "Only included activity costs supply the budget. Your general amount stays saved."} Adding, editing, or removing activities never switches methods.</p></section>}
      {category === "restaurants" && <section className="hotel-budget-panel" aria-label="Food budget"><div className="section-heading"><h2>Food budget</h2><div className="heading-actions"><button className="button secondary small" onClick={() => open({ kind: "foodBudget", item: place, nights: visit.nights })}><Pencil size={15} />Edit food budget</button>{stay && <button className="button secondary small" onClick={() => open({ kind: "stayNights", stop: stay })}><CalendarDays size={15} />Edit destination nights</button>}</div></div><FoodSummary snapshot={data} destination={visit} /><p className="helper">{place.foodBudgetMode === "daily" ? "Your daily subtotal supplies the budget. Restaurant selections are saved for itemized mode." : "Only included restaurant costs supply the budget. Your daily amount stays saved."} Adding, editing, or removing restaurants never switches methods.</p></section>}
      {!stay && category !== "activities" && <p className="helper">Nights belong to each trip, so stay totals here wait for one. Each trip’s pages for this destination show its own.</p>}
      <div className="list-intro"><p>{category === "hotels" ? "Choose one hotel to replace the general estimate. Uncheck it to restore the estimate." : category === "activities" ? "Save ideas and choose which to include when using itemized activity costs." : "Save ideas and choose which to include when using itemized restaurant costs."} Ideas and selections are shared by every trip that visits {label}.</p><span>Prices in USD · whole party</span></div>
      {data.candidates.filter((item) => item.destinationId === place.id && item.category === category).length === 0 && <div className="empty-state ideas-empty"><h3>{category === "hotels" ? "A good night's sleep starts here." : category === "activities" ? "Leave a little room for discovery." : "Something delicious to look forward to."}</h3><p>Save your first {singular[category]} idea for {label}.<br />You can add a price now or come back to it later.</p></div>}
      <CandidateList items={data.candidates.filter((item) => item.destinationId === place.id && item.category === category)} category={category} destination={place} busy={busy}
        onEdit={(item) => open({ kind: "candidate", item })}
        onDelete={(item) => confirmDelete({ type: "candidate.delete", id: item.id }, "Delete “" + item.name + "”?", "This idea will be removed from " + label + ", in every trip that visits it.")}
        onMutate={(mutation, success) => { void perform(mutation, success); }} />
      </>}
    </>;
  }
  /** One destination's page in Destinations: its shared research, and the trips that visit it with each stay's estimate. */
  function renderDestination(place: Destination) {
    const label = formatSavedDestinationLabel(place.city);
    const placeAccess = destinationAccess[place.id];
    const stays = visitsOf(place.id);
    return <>
      <Link href="/destinations" className="breadcrumb"><ArrowLeft size={16} />All destinations</Link>
      <section className="trip-heading"><div><p className="eyebrow">A PLACE WORTH KNOWING</p><h1>{label}</h1><div className="trip-meta">{label !== place.city && <span><MapPin size={17} />{place.city}</span>}<span><Plane size={17} />{stays.length ? "In " + count(new Set(stays.map((visit) => visit.trip.id)).size, "trip", "trips") : "Not in a trip"}</span>{placeAccess?.role === "editor" && <span><Share2 size={17} />{"Shared by " + memberLabel(placeAccess.owner)}</span>}</div>{place.notes && <p className="trip-notes">{place.notes}</p>}</div>
        <div className="heading-actions"><button className="button secondary" onClick={() => open({ kind: "destination", item: place })}><Pencil size={15} />Edit destination</button>{placeAccess?.role === "owner" && stays.length === 0 && <button className="icon-button" aria-label="Delete destination" onClick={() => confirmDelete({ type: "destination.delete", id: place.id }, "Delete this destination?", "“" + label + "” and everything saved for it will be removed: its hotels, activities, restaurants, churches, photos, notes, budget amounts, entry requirements, health and safety, and typical weather.", "/destinations")}><Trash2 size={18} /></button>}</div>
      </section>
      <div className="trip-layout"><div className="trip-main">
        <article className="destination-card" id={"destination-" + place.id}><DestinationGallery destination={place} />
          <DestinationBudget snapshot={data} visit={{ ...place, nights: null }} onShoppingEdit={() => open({ kind: "shoppingBudget", item: place })} onMiscellaneousEdit={() => open({ kind: "miscellaneousBudget", item: place, nights: null })} />
          <EntryRequirementsPanel requirements={place.entryRequirements} disabled={busy} onEdit={() => open({ kind: "entryRequirements", item: place })} onClear={() => confirmDelete({ type: "destination.entryRequirements", id: place.id, requirements: null }, "Clear entry requirements?", "This removes the recorded requirements, sources, and last checked date for " + label + ", in every trip that visits it.")} />
          <HealthSafetyPanel healthSafety={place.healthSafety} disabled={busy} onEdit={() => open({ kind: "healthSafety", item: place })} onClear={() => confirmDelete({ type: "destination.healthSafety", id: place.id, healthSafety: null }, "Clear health and safety?", "This removes the recorded advisories, precautions, safety guidance, emergency contacts, sources, and last checked date for " + label + ", in every trip that visits it.")} />
          <TypicalWeatherPanel weather={place} disabled={busy} onEdit={() => open({ kind: "weather", item: place })} />
          {renderChurch(place)}
        </article>
      </div>
      <aside className="budget-panel"><span className="budget-symbol"><Plane size={23} strokeWidth={1.4} /></span><p className="eyebrow">WHERE IT FITS</p><h2>In your trips</h2>
        {stays.length ? <ul className="destination-trips">{stays.map(({ trip: visiting, stop: stay }) => {
          const estimate = calculateDestinationBudget(data, { ...place, nights: stay.nights });
          return <li key={stay.id}><Link href={"/trips/" + visiting.id + "#destination-" + stay.id}>{visiting.name}</Link>
            <span>{stay.nights === null ? "Nights unknown" : count(stay.nights, "night", "nights")}{stay.arrivalDate && stay.departureDate ? " · " + formatCalendarDate(stay.arrivalDate) + " → " + formatCalendarDate(stay.departureDate) : ""}</span>
            <span><strong><CurrencyTotals totals={estimate.totalsByCurrency} /></strong> {estimate.complete ? "estimate" : "partial estimate"}</span></li>;
        })}</ul> : <p className="helper">Not in any of your trips. It stays here with everything saved for it.</p>}
        <p className="helper">Changes here appear in every trip that visits this destination. Each trip keeps its own nights, dates, stay notes, and travel connections.</p>
        {placeAccess?.role === "owner" && stays.length > 0 && <p className="helper">To delete this destination, first remove it from each trip that visits it.</p>}
      </aside></div>
    </>;
  }
  // Selected tags no trip has any longer drop out of the filter.
  const filterTags = data.tags.filter((tag) => tagFilter.includes(tagKey(tag)));
  const toggleTagFilter = (tag: string) => setTagFilter((keys) => keys.includes(tagKey(tag)) ? keys.filter((key) => key !== tagKey(tag)) : [...keys, tagKey(tag)]);
  // A trip shows when it matches the search and has every selected tag.
  const visibleTrips = data.trips.filter((item) => hasEveryTag(item.tags, filterTags) && [item.name, item.dateLabel, ...tripCities(item.id).flatMap((city) => [city, formatSavedDestinationLabel(city)])].join(" ").toLowerCase().includes(search.toLowerCase()));
  const visibleDestinations = data.destinations.filter((item) => [item.city, formatSavedDestinationLabel(item.city), ...visitsOf(item.id).map((visit) => visit.trip.name)].join(" ").toLowerCase().includes(search.toLowerCase()));
  /** Same-named cities can share a short label, so the list shows their full saved names. */
  const sharesLabel = (item: Destination) => data.destinations.some((other) => other.id !== item.id && formatSavedDestinationLabel(other.city) === formatSavedDestinationLabel(item.city));

  return <div className="app-shell">
    <main id="main-content" className="main-content">
      {!tripId && !destinationId && !destinationList && <>
        <section className="home-hero"><div><p className="eyebrow">THE PLACES WE MIGHT GO</p><h1>Somewhere<br /><em>worth going.</em></h1><p className="hero-description">Big adventures, little escapes, and every possibility in between.<br className="desktop-break" /> Give your next idea a place to begin.</p>
          <button className="button primary" onClick={() => open({ kind: "trip" })}><Plus size={18} />New trip</button></div>
          <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><span className="art-n">N</span><Compass className="art-compass" size={132} strokeWidth={0.7} /><span className="art-note">a little room<br />for adventure</span><Plane className="art-plane" size={34} strokeWidth={1.3} /></div>
        </section>
        <section className="trips-section"><div className="section-heading"><div className="heading-inline"><h2>Your possibilities</h2><span className="count-pill">{data.trips.length}</span></div>
          {data.trips.length > 0 && <label className="search-field"><Search size={17} /><input aria-label="Search trips" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a trip or city" /></label>}</div>
          {data.tags.length > 0 && <TripTagFilter tags={data.tags} selected={filterTags} onToggle={toggleTagFilter} onClear={() => setTagFilter([])} />}
          {data.trips.length === 0 ? <div className="empty-state home-empty"><span className="empty-icon"><MapPin size={28} strokeWidth={1.5} /></span><h3>Every trip starts with a possibility.</h3><p>A weekend away? A place you have always wanted to see?<br />Add your first trip and work out the details as you go.</p><button className="button secondary" onClick={() => open({ kind: "trip" })}><Plus size={17} />Create your first trip</button></div>
            : visibleTrips.length === 0 ? <div className="empty-state"><h3>{!filterTags.length ? "No trips match that search." : search ? "No trips match that search and every selected tag." : "No trips have every selected tag."}</h3>{search && <button className="text-button" onClick={() => setSearch("")}>Clear search</button>}{filterTags.length > 0 && <button className="text-button" onClick={() => setTagFilter([])}>Clear tag filters</button>}</div>
            : <div className="trip-grid">{visibleTrips.map((item, index) => {
              const cities = tripCities(item.id);
              const estimate = homeBudgets[item.id];
              const itemAccess = access[item.id];
              return <article className={"trip-card tone-" + (index % 3)} key={item.id}>
                <Link className="trip-card-main" href={"/trips/" + item.id}><div className="trip-card-top"><span className="trip-number">TRIP {String(index + 1).padStart(2, "0")}</span><Compass size={38} strokeWidth={1} /></div>
                  <h3>{item.name}</h3><p className="city-list"><MapPin size={15} />{cities.length ? cities.map((city) => formatSavedDestinationLabel(city)).join(" → ") : "Destinations to be decided"}</p>
                  <div className="trip-meta"><span><CalendarDays size={15} />{item.startDate ? formatCalendarDate(item.startDate) + " → " + formatCalendarDate(item.endDate) : item.dateLabel || "Whenever the time is right"}</span><span><Users size={15} />{item.travelers} {item.travelers === 1 ? "traveler" : "travelers"}</span>{itemAccess.role === "editor" && <span><Share2 size={15} />{"Shared by " + memberLabel(itemAccess.owner)}</span>}</div>
                  <TripTagList tags={item.tags} />
                  <div className="card-budget"><div><span className="small-label">ESTIMATED BUDGET</span><BudgetValue budget={estimate} /></div><span className="round-arrow"><ArrowRight size={19} /></span></div>
                </Link><div className="card-tools"><button className="text-button" aria-label={"Edit " + item.name} onClick={() => open({ kind: "trip", item })}><Pencil size={14} />Edit</button>{itemAccess.role === "owner" && <button className="icon-button muted" aria-label={"Delete " + item.name} onClick={() => confirmDelete({ type: "trip.delete", id: item.id }, "Delete “" + item.name + "”?", "This removes the trip, its travel plans, and At home items. Its destinations, with their saved ideas and research, stay in Destinations." + sharedDeleteNote(itemAccess))}><Trash2 size={15} /></button>}</div>
              </article>;
            })}</div>}
        </section>
      </>}

      {trip && !stopId && <>
        <Link href="/" className="breadcrumb"><ArrowLeft size={16} />All trips</Link>
        <section className="trip-heading"><div><p className="eyebrow">AN ADVENTURE IN THE MAKING</p><h1>{trip.name}</h1><div className="trip-meta"><span><CalendarDays size={17} />{trip.startDate ? formatCalendarDate(trip.startDate) + " → " + formatCalendarDate(trip.endDate) : trip.dateLabel || "Dates to be decided"}</span><span><Users size={17} />{trip.travelers} {trip.travelers === 1 ? "traveler" : "travelers"}</span><span><MapPin size={17} />{trip.homeCity ? "Departing: " + trip.homeCity : "Add departing city"}</span>{trip.returnCity && <span><MapPin size={17} />Returning: {trip.returnCity}</span>}{tripAccess?.role === "editor" && <span><Share2 size={17} />{"Shared by " + memberLabel(tripAccess.owner)}</span>}{tripAccess?.role === "owner" && tripAccess.sharedWith.length > 0 && <span><Share2 size={17} />{"Shared with " + tripAccess.sharedWith.length + (tripAccess.sharedWith.length === 1 ? " person" : " people")}</span>}</div>
          <TripTagsEditor tags={trip.tags} available={data.tags} busy={busy} onAdd={(name) => perform({ type: "trip.tag", tripId: trip.id, name }, "Tag added.")} onRemove={(name) => void perform({ type: "trip.untag", tripId: trip.id, name }, "Tag removed.")} />
          {trip.notes && <p className="trip-notes">{trip.notes}</p>}</div>
          <div className="heading-actions"><button className="button secondary" onClick={() => open({ kind: "trip", item: trip })}><Pencil size={15} />Edit trip</button>{tripAccess?.role === "owner" && <><button className="button secondary" onClick={() => open({ kind: "share" })}><UserPlus size={15} />Share</button><button className="icon-button" aria-label="Delete trip" onClick={() => confirmDelete({ type: "trip.delete", id: trip.id }, "Delete this trip?", "“" + trip.name + "”, its travel plans, and At home items will be removed. Its destinations, with their saved ideas and research, stay in Destinations." + sharedDeleteNote(tripAccess), "/")}><Trash2 size={18} /></button></>}</div>
        </section>
        <div className="trip-layout"><div className="trip-main">
          <section><div className="section-heading"><div><p className="eyebrow">ONE STOP AT A TIME</p><h2>The destinations</h2></div><button className="button secondary small" onClick={() => open({ kind: "addStop" })}><Plus size={16} />Add destination</button></div>
            {visits.length === 0 ? <div className="empty-state"><MapPin size={29} strokeWidth={1.4} /><h3>Where should this trip take you?</h3><p>Add your first destination. Your departure and return connections will appear automatically.</p><button className="text-button" onClick={() => open({ kind: "addStop" })}>Add a destination <ArrowRight size={16} /></button></div>
              : <div className="destination-list">{visits.map(({ stop: visitStop, visit }, index) => { const label = formatSavedDestinationLabel(visit.city); return <article className="destination-card" key={visitStop.id} id={"destination-" + visitStop.id}><DestinationGallery destination={visit} /><div className="destination-top"><span className="stop-number">{String(index + 1).padStart(2, "0")}</span><div className="destination-name"><h3><Link href={"/destinations/" + visit.id}>{label}</Link></h3><p>{visitStop.stay || "Stay notes not added"}</p></div><div className="destination-tools"><button className="icon-button" disabled={busy || index === 0} aria-label={"Move " + label + " up"} onClick={() => void perform({ type: "stop.move", id: visitStop.id, direction: "up" }, "Route updated. Review the new travel connections.")}><ArrowUp size={15} /></button><button className="icon-button" disabled={busy || index === visits.length - 1} aria-label={"Move " + label + " down"} onClick={() => void perform({ type: "stop.move", id: visitStop.id, direction: "down" }, "Route updated. Review the new travel connections.")}><ArrowDown size={15} /></button><button className="icon-button" aria-label={"Edit " + label} onClick={() => open({ kind: "destination", item: visit, stop: visitStop })}><Pencil size={15} /></button><button className="icon-button" aria-label={"Remove " + label + " from this trip"} onClick={() => confirmDelete({ type: "stop.remove", id: visitStop.id }, "Remove “" + label + "” from this trip?", "Its hotels, activities, restaurants, photos, and research stay in Destinations and in any other trip. This trip’s nights, stay notes, and travel plans to and from it are removed, and the remaining route reconnects.")}><Trash2 size={15} /></button></div></div>
                {visit.notes && <p className="destination-notes">{visit.notes}</p>}
                <DestinationBudget snapshot={data} visit={visit} stop={visitStop} onShoppingEdit={() => open({ kind: "shoppingBudget", item: visit })} onMiscellaneousEdit={() => open({ kind: "miscellaneousBudget", item: visit, nights: visit.nights })} />
                <EntryRequirementsPanel requirements={visit.entryRequirements} stay={visitStop} disabled={busy} onEdit={() => open({ kind: "entryRequirements", item: visit })} onClear={() => confirmDelete({ type: "destination.entryRequirements", id: visit.id, requirements: null }, "Clear entry requirements?", "This removes the recorded requirements, sources, and last checked date for " + label + ", in every trip that visits it.")} />
                <HealthSafetyPanel healthSafety={visit.healthSafety} disabled={busy} onEdit={() => open({ kind: "healthSafety", item: visit })} onClear={() => confirmDelete({ type: "destination.healthSafety", id: visit.id, healthSafety: null }, "Clear health and safety?", "This removes the recorded advisories, precautions, safety guidance, emergency contacts, sources, and last checked date for " + label + ", in every trip that visits it.")} />
                <TypicalWeatherPanel weather={visit} disabled={busy} onEdit={() => open({ kind: "weather", item: visit })} />
                {renderChurch(visit, visitStop)}
              </article>; })}</div>}
            {visits.length > 1 && <p className="helper">Use the arrows to change your route. Affected travel connections will need new details.</p>}
            {visits.length > 0 && <p className="helper">A destination’s ideas, research, photos, selections, and budget amounts are shared with every trip that visits it, and with Destinations. Each trip keeps its own nights, dates, stay notes, and travel connections.</p>}
          </section>
          <section className="travel-section"><div className="section-heading"><div><p className="eyebrow">GETTING THERE & BACK</p><h2>Between the places</h2></div><Plane size={25} strokeWidth={1.3} /></div>
            {visits.length === 0 ? <p className="section-description">Your travel connections will appear once you add a destination.</p> : <div className="travel-list">{tripLegs.map((leg) => <article className="travel-card" key={leg.id}><TransportationIcons method={leg.method} /><div className="travel-content"><h3>{legName(leg.fromId, "from")} <ArrowRight size={15} /> {legName(leg.toId, "to")}</h3><p>{leg.method || "Travel details to be decided"}{leg.departure && " · " + leg.departure}{leg.arrival && " → " + leg.arrival}</p>{leg.notes && <p className="preserve-lines">{leg.notes}</p>}<ResearchLinks links={leg.links ?? []} /><ConnectionItinerary stops={leg.itinerary ?? []} /><span className={leg.priceCents === null ? "price unknown" : "price"}>{displayPrice(leg.priceCents)}{leg.priceCents === null && " · Needs estimate"}</span></div><div className="travel-tools"><button className="text-button" aria-label={"Edit travel from " + legName(leg.fromId, "from") + " to " + legName(leg.toId, "to")} onClick={() => open({ kind: "leg", item: leg })}><Pencil size={14} />Edit</button>{(leg.method || leg.priceCents !== null || leg.notes || leg.url || leg.departure || leg.arrival || (leg.itinerary?.length ?? 0) > 0 || (leg.links?.length ?? 0) > 0) && <button className="text-button muted" onClick={() => confirmDelete({ type: "leg.clear", id: leg.id }, "Clear this travel plan?", "The connection will remain in your route, with its price, travel details, links, and itinerary cleared.")}>Clear</button>}</div></article>)}</div>}
          </section>
          <HomeItems items={data.homeItems.filter((item) => item.tripId === trip.id)} busy={busy}
            onAdd={() => open({ kind: "homeItem" })}
            onEdit={(item) => open({ kind: "homeItem", item })}
            onDelete={(item) => confirmDelete({ type: "homeItem.delete", id: item.id, tripId: trip.id }, "Delete “" + item.name + "”?", "This removes the item and any cost from the trip estimate.")}
            onComplete={(item) => void perform({ type: "homeItem.complete", id: item.id, tripId: trip.id, completed: !item.completed }, item.completed ? "Item reopened." : "Item marked complete.")} />
        </div>
        {budget && <aside className="budget-panel"><span className="budget-symbol"><Wallet size={23} strokeWidth={1.4} /></span><p className="eyebrow">ROOM IN THE BUDGET</p><h2>The trip estimate</h2><div className="budget-total"><BudgetValue budget={budget} /></div><p className="budget-caption">Total for {trip.travelers === 1 ? "1 traveler" : "all " + trip.travelers + " travelers"}</p><dl className="budget-breakdown"><div><dt>Travel{budget.travelMissingCount > 0 && <small>{budget.travelMissingCount} not estimated</small>}</dt><dd>{tripLegs.some((leg) => leg.priceCents !== null) ? formatCurrency(budget.travelCents, "USD") : "Not estimated"}</dd></div><div><dt>Hotels{budget.hotelMissingCount > 0 && <small>{budget.hotelMissingCount} not estimated</small>}</dt><dd><CurrencyTotals totals={budget.hotelsByCurrency} /></dd></div><div><dt>Activities{budget.activitiesMissingCount > 0 && <small>{budget.activitiesMissingCount} not estimated</small>}</dt><dd><CurrencyTotals totals={budget.activitiesByCurrency} empty={budget.activitiesMissingCount ? "Not estimated" : "$0"} /></dd></div><div><dt>Food{budget.foodMissingCount > 0 && <small>{budget.foodMissingCount} not estimated</small>}</dt><dd><CurrencyTotals totals={budget.foodByCurrency} empty={budget.foodMissingCount ? "Not estimated" : "$0"} /></dd></div><div><dt>Shopping</dt><dd><CurrencyTotals totals={budget.shoppingByCurrency} empty="Not set" /></dd></div><div><dt>At home</dt><dd>{formatCurrency(budget.homeCents, "USD")}</dd></div><div><dt>Miscellaneous{budget.miscMissingCount > 0 && <small>{budget.miscMissingCount} not estimated</small>}</dt><dd><CurrencyTotals totals={budget.miscellaneousByCurrency} /></dd></div></dl><div className="budget-note">{budget.complete ? <CheckCircle2 size={17} /> : <MoreHorizontal size={20} />}<p>{budget.complete ? "All required estimates are added." : budget.missingCount + " " + (budget.missingCount === 1 ? "detail still needs" : "details still need") + " an estimate or a choice."}</p></div><p className="helper">Includes travel, accommodation from the selected hotel or general nightly estimate, the selected activities and food budgeting methods, shopping, miscellaneous spending, and any At home costs. Missing estimates are excluded. All amounts are USD for the whole party.</p></aside>}
        </div>
      </>}

      {trip && stop && destination && renderIdeas(destination, stop, { href: "/trips/" + trip.id + "#destination-" + stop.id, label: trip.name + " · " + formatSavedDestinationLabel(destination.city) })}

      {destinationList && <>
        <section className="ideas-heading"><div><p className="eyebrow">EVERY PLACE YOU HAVE LOOKED INTO</p><h1>Destinations</h1><p className="hero-description">Each city keeps one set of hotels, activities, restaurants, and research, shared by every trip that visits it.</p></div><button className="button primary" onClick={() => open({ kind: "newDestination" })}><Plus size={17} />New destination</button></section>
        <section className="trips-section"><div className="section-heading"><div className="heading-inline"><h2>Saved destinations</h2><span className="count-pill">{data.destinations.length}</span></div>
          {data.destinations.length > 0 && <label className="search-field"><Search size={17} /><input aria-label="Search destinations" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a city or trip" /></label>}</div>
          {data.destinations.length === 0 ? <div className="empty-state home-empty"><span className="empty-icon"><MapPin size={28} strokeWidth={1.5} /></span><h3>No destinations yet.</h3><p>Add a city to research it before it is in a trip. Destinations you add to trips appear here too, and stay here with everything saved for them even after they leave every trip.</p><button className="button secondary" onClick={() => open({ kind: "newDestination" })}><Plus size={17} />Add your first destination</button></div>
            : visibleDestinations.length === 0 ? <div className="empty-state"><h3>No destinations match that search.</h3><button className="text-button" onClick={() => setSearch("")}>Clear search</button></div>
            : <div className="trip-grid">{visibleDestinations.map((item, index) => {
              const trips = visitsOf(item.id).map((visit) => visit.trip.name);
              const itemAccess = destinationAccess[item.id];
              const ideas = (kind: Category) => data.candidates.filter((candidate) => candidate.destinationId === item.id && candidate.category === kind).length;
              return <article className={"trip-card tone-" + (index % 3)} key={item.id}>
                <Link className="trip-card-main" href={"/destinations/" + item.id}><div className="trip-card-top"><span className="trip-number">DESTINATION {String(index + 1).padStart(2, "0")}</span><MapPin size={34} strokeWidth={1} /></div>
                  <h3>{formatSavedDestinationLabel(item.city)}</h3>{sharesLabel(item) && <p className="destination-full-name">{item.city}</p>}
                  <p className="city-list"><Plane size={15} />{trips.length ? [...new Set(trips)].join(" · ") : "Not in a trip"}</p>
                  <div className="trip-meta"><span><BedDouble size={15} />{count(ideas("hotels"), "hotel", "hotels")}</span><span><Binoculars size={15} />{count(ideas("activities"), "activity", "activities")}</span><span><Utensils size={15} />{count(ideas("restaurants"), "restaurant", "restaurants")}</span>{itemAccess?.role === "editor" && <span><Share2 size={15} />{"Shared by " + memberLabel(itemAccess.owner)}</span>}</div>
                </Link>
              </article>;
            })}</div>}
        </section>
      </>}

      {!tripId && destination && !category && !church && renderDestination(destination)}

      {!tripId && destination && (category || church) && renderIdeas(destination, undefined, { href: "/destinations/" + destination.id, label: formatSavedDestinationLabel(destination.city) })}
      {!trip && tripId && <div className="empty-state"><h1>This trip is no longer here.</h1><Link href="/">Back to all trips</Link></div>}
      {!tripId && destinationId && !destination && <div className="empty-state"><h1>This destination is no longer here.</h1><Link href="/destinations">Back to all destinations</Link></div>}
      {message && <div className="toast" role="status"><CheckCircle2 size={17} />{message}<button aria-label="Dismiss message" className="icon-button" onClick={() => setMessage("")}><X size={14} /></button></div>}
      {/* Controls that save without an editor, such as Move or Include, can be far from the end of the page, so their errors stay in view like the toast. An editor shows its own above its buttons. */}
      {error && !editor && <div className="toast error-toast" role="alert"><CircleAlert size={17} aria-hidden="true" />{error}<button aria-label="Dismiss error" className="icon-button" onClick={() => setError("")}><X size={14} /></button></div>}
    </main>
    <footer className="site-footer"><span><Compass size={15} />For the trips still taking shape.</span><span>Shared editing · whole-party estimates</span></footer>
    {editor && <Dialog title={pageTitle} busy={busy} onClose={close}><form id="planner-editor" onSubmit={submit}><div className="form-grid dialog-body">
      {editor.kind === "delete" && <p className="delete-description wide">{editor.description} This cannot be undone.</p>}
      {editor.kind === "trip" && <>
        <Field label="Trip name" wide><input name="name" defaultValue={editor.item?.name} required maxLength={120} placeholder="A long weekend in the mountains" /></Field>
        <Field label="General date" hint="Exact dates can wait."><input name="dateLabel" defaultValue={editor.item?.dateLabel} maxLength={120} placeholder="Spring 2027, or sometime soon" /></Field>
        <Field label="Trip start date" hint="Destination dates and the trip end are calculated from this date and each stay’s nights."><input name="startDate" type="date" min="0001-01-01" max="9999-12-31" defaultValue={editor.item?.startDate ?? ""} /></Field>
        <p className="helper wide">Trip end (calculated after saving): {formatCalendarDate(editor.item?.endDate)}</p>
        <Field label="Travelers"><input name="travelers" type="number" min="1" max="999" step="1" required defaultValue={editor.item?.travelers ?? 2} /></Field>
        <TripRouteFields trip={editor.item} disabled={busy} /><Notes value={editor.item?.notes} />
      </>}
      {editor.kind === "destination" && <>
        <p className="helper wide">The city, budget amounts, photos, and notes are shared by every trip that visits this destination.{editor.stop && " Stay notes and nights are for this trip only."}</p>
        <LocationField compactDestination label="City or destination" name="city" defaultValue={editor.item.city} required disabled={busy} placeholder="Start typing a city, e.g. Vienna" helpText="Choose a suggestion or enter any destination." hint="Changing the city changes it in every trip that visits this destination, and clears travel details for its incoming and outgoing connections." />
        {trip && editor.stop && <Field label="Stay notes" hint="For this trip only." wide><input name="stay" defaultValue={editor.stop.stay} maxLength={120} placeholder="3 nights, or sometime in May" /></Field>}
        <DestinationBudgetEditor stay={trip && editor.stop ? { trip, stops, stop: editor.stop } : undefined} destination={editor.item} selectedHotel={selectedHotel(editor.item.id)} disabled={busy} />
        <DestinationGalleryEditor destination={editor.item} draft={destinationGallery} onChange={setDestinationGallery} disabled={busy} />
        <Notes value={editor.item.notes} />
      </>}
      {/* A trip visits its owner's destinations, so a city the owner has comes with everything saved for it. */}
      {editor.kind === "addStop" && <LocationField compactDestination label="City or destination" name="city" required disabled={busy} placeholder="Start typing a city, e.g. Vienna" helpText="Choose a suggestion or enter any destination." hint={"If " + (tripAccess?.role === "editor" ? memberLabel(tripAccess.owner) + " already has" : "you already have") + " this destination, it’s added with everything saved for it. A city already in this trip opens instead."} />}
      {editor.kind === "newDestination" && <LocationField compactDestination label="City or destination" name="city" required disabled={busy} placeholder="Start typing a city, e.g. Vienna" helpText="Choose a suggestion or enter any destination." hint="If you already have this destination, its page opens instead." />}
      {editor.kind === "church" && <ChurchEditor item={editor.item} massTimes={massTimes} onTimesChange={setMassTimes} gallery={candidateGallery} onGalleryChange={setCandidateGallery} busy={busy} />}
      {editor.kind === "entryRequirements" && <EntryRequirementsEditor requirements={editor.item.entryRequirements} sources={researchLinks} onSourcesChange={setResearchLinks} disabled={busy} />}
      {editor.kind === "healthSafety" && <HealthSafetyEditor healthSafety={editor.item.healthSafety} contacts={emergencyContacts} onContactsChange={setEmergencyContacts} sources={researchLinks} onSourcesChange={setResearchLinks} disabled={busy} />}
      {editor.kind === "weather" && <TypicalWeatherEditor weather={editor.item} disabled={busy} />}
      {editor.kind === "shoppingBudget" && <ShoppingBudgetEditor destination={editor.item} disabled={busy} />}
      {editor.kind === "accommodationBudget" && <AccommodationBudgetEditor destination={editor.item} selectedHotel={selectedHotel(editor.item.id)} stay={trip && editor.stop ? { trip, stops, stop: editor.stop } : undefined} disabled={busy} />}
      {editor.kind === "miscellaneousBudget" && <MiscellaneousBudgetEditor destination={editor.item} nights={editor.nights} disabled={busy} />}
      {editor.kind === "stayNights" && trip && <StayNightsEditor stay={{ trip, stops, stop: editor.stop }} disabled={busy} />}
      {editor.kind === "foodBudget" && <FoodBudgetEditor destination={editor.item} nights={editor.nights} disabled={busy} />}
      {editor.kind === "activitiesBudget" && <ActivitiesBudgetEditor destination={editor.item} disabled={busy} />}
      {editor.kind === "leg" && <>
        <p className="form-route wide">{legName(editor.item.fromId, "from")} <ArrowRight size={16} /> {legName(editor.item.toId, "to")}</p>
        <Field label="Transportation" wide><input name="method" defaultValue={editor.item.method} maxLength={120} placeholder="Flight, train, rental car…" /></Field>
        <Field label="Estimated price (USD)" wide hint="Total for the whole party for the full connection, including itinerary stops. Leave blank if unknown."><input name="price" type="number" className="no-spin-buttons" min="0" max={MAX_AMOUNT_DOLLARS} step="0.01" defaultValue={minorAmountValue(editor.item.priceCents, "USD")} placeholder="Not estimated" /></Field>
        <Field label="Departure"><input name="departure" defaultValue={editor.item.departure} maxLength={120} placeholder="Date, time, or general plan" /></Field>
        <Field label="Arrival"><input name="arrival" defaultValue={editor.item.arrival} maxLength={120} placeholder="Date, time, or general plan" /></Field>
        <ResearchLinksEditor links={researchLinks} onChange={setResearchLinks} disabled={busy} /><Notes value={editor.item.notes} />
        <ConnectionItineraryEditor stops={itinerary} onChange={setItinerary} disabled={busy} />
      </>}
      {editor.kind === "homeItem" && <>
        <Field label="Name" wide><input name="name" defaultValue={editor.item?.name} required maxLength={160} placeholder="House sitting, babysitting, or another task" disabled={busy} /></Field>
        <Field label="Estimated price (USD, optional)" wide hint="Add the total cost for this trip, or leave blank if there is no cost to add. You can add a price later."><input name="price" type="number" className="no-spin-buttons" min="0" max={MAX_AMOUNT_DOLLARS} step="0.01" defaultValue={minorAmountValue(editor.item?.priceCents, "USD")} placeholder="No price added" disabled={busy} /></Field>
        <Field label="Notes" wide><textarea name="notes" defaultValue={editor.item?.notes} maxLength={8000} rows={3} placeholder="Contacts, arrangements, or anything to remember" disabled={busy} /></Field>
        <label className="checkbox-field wide"><input name="completed" type="checkbox" defaultChecked={editor.item?.completed ?? false} disabled={busy} /><span>Completed<small>Any price stays in the trip estimate when this item is complete.</small></span></label>
      </>}
      {editor.kind === "share" && trip && tripAccess?.role === "owner" && <TripSharing access={tripAccess} busy={busy}
        onRemove={(member) => void perform({ type: "trip.unshare", tripId: trip.id, email: member.email }, member.email + " can no longer open this trip.")} />}
      {editor.kind === "candidate" && category && <>
        <Field label="Name" wide><input name="name" defaultValue={editor.item?.name} required maxLength={160} placeholder={"Name of the " + singular[category]} /></Field>
        <Field label="Estimated price (USD)" wide hint={priceNotes[category] + " Leave blank if unknown."}><input name="price" type="number" min="0" max={MAX_AMOUNT_DOLLARS} step="0.01" defaultValue={minorAmountValue(editor.item?.priceCents, "USD")} placeholder="Not estimated" /></Field>
        <Field label="Address or neighborhood" wide><input name="address" defaultValue={editor.item?.address} maxLength={500} placeholder="Optional" /></Field>
        <CandidateGalleryEditor candidate={editor.item} subject={singular[category]} draft={candidateGallery} onChange={setCandidateGallery} disabled={busy} />
        <ResearchLinksEditor links={researchLinks} onChange={setResearchLinks} disabled={busy} /><Notes value={editor.item?.notes} />
        {category !== "hotels" && <label className="checkbox-field wide"><input name="mustDo" type="checkbox" defaultChecked={editor.item?.mustDo ?? false} disabled={busy} /><span>Must do<small>A planning priority. Budget inclusion and list order stay separate.</small></span></label>}
        <label className="checkbox-field wide"><input name="included" type="checkbox" defaultChecked={editor.item?.included ?? false} /><span>{category === "hotels" ? "Choose this hotel for the budget" : category === "activities" ? "Include in itemized activity costs" : "Include in itemized restaurant costs"}<small>{category === "hotels" ? "Replaces the general estimate or other chosen hotel. Your general estimate stays saved." : category === "activities" ? "Applies only in Itemized activity costs mode. This does not change your budgeting method." : "Applies only in Itemized restaurant costs mode. This does not change your budgeting method."}</small></span></label>
      </>}
    </div><div className="dialog-footer">{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button secondary" onClick={close} disabled={busy}>Cancel</button><button className={editor.kind === "delete" ? "button danger" : "button primary"} type="submit" disabled={busy}>{busy ? "Saving…" : editor.kind === "delete" ? (editor.mutation.type === "leg.clear" ? "Clear travel plan" : editor.mutation.type === "destination.entryRequirements" ? "Clear entry requirements" : editor.mutation.type === "destination.healthSafety" ? "Clear health and safety" : editor.mutation.type === "stop.remove" ? "Remove from trip" : "Delete") : editor.kind === "trip" && !editor.item ? "Create trip" : editor.kind === "addStop" ? "Add destination" : editor.kind === "newDestination" ? "Create destination" : editor.kind === "share" ? "Share" : "Save changes"}</button></div></div></form></Dialog>}
  </div>;
}
