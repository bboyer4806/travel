"use client";

import Link from "next/link";
import { FeedbackButton } from "@/components/feedback";
import { HelpButton } from "@/components/help";
import { churchDateEligible, formatCalendarDate } from "@/lib/trip-dates";
import LocationField from "@/components/location-field";
import HomeItems from "@/components/home-items";
import PackingList, { PackingItemFields, PackingReviewFields } from "@/components/packing-list";
import { chosenItems, packingReview, recommendPacking, type PackingCategory, type PackingReview } from "@/lib/packing";
import { ChurchSundays } from "@/components/church-sundays";
import { EntryRequirementsPanel, EntryRequirementsEditor } from "@/components/entry-requirements";
import { entryRequirementsFromForm } from "@/lib/entry-requirements";
import { HealthSafetyPanel, HealthSafetyEditor } from "@/components/health-safety";
import { healthSafetyFromForm, providerDraft, type EmergencyContact, type MedicalProviderDraft } from "@/lib/health-safety";
import { ChurchOptions, ChurchEditor, ChurchDetails, ChurchSection } from "@/components/churches";
import { MonthlyClimateEditor, TypicalWeatherPanel, TypicalWeatherEditor } from "@/components/typical-weather";
import { monthlyClimateFromForm } from "@/lib/typical-weather";
import { DestinationCardPhoto, DestinationGallery, DestinationGalleryEditor } from "@/components/destination-gallery";
import CandidateList from "@/components/candidate-list";
import { carouselOrder, DestinationIdeas, IdeaDetails, priceNotes, selectionLabels } from "@/components/destination-ideas";
import { ActivitySteps, SwipeBody } from "@/components/activity-steps";
import { CandidateGalleryEditor } from "@/components/candidate-gallery";
import { createGalleryDraft, galleryForm, type GalleryDraft } from "@/lib/gallery-draft";
import { TripImageEditor, TripImageView } from "@/components/trip-image";
import { createTripImageDraft, tripImageForm, type TripImageDraft } from "@/lib/trip-image-draft";
import { RestaurantTypesField } from "@/components/restaurant-types";
import { PlaceLocationFields } from "@/components/place-location";
import { coordinatesFromForm } from "@/lib/coordinates";
import TripRouteFields from "@/components/trip-route-fields";
import { ConnectionItinerary, ConnectionItineraryEditor } from "@/components/connection-itinerary";
import { FlightDetails, TransportationFields } from "@/components/connection-flight";
import { LayoverPlanEditor } from "@/components/layover-plan";
import { layoverPlanDraft, layoverPlanFromDraft, type LayoverPlanDraft } from "@/lib/layover-plan";
import { ResearchLinks, ResearchLinksEditor } from "@/components/research-links";
import { unstable_isUnrecognizedActionError, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { controlOrNeighbor, useFocusAfter, useFocusFallback } from "@/components/focus-after";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BedDouble, Binoculars, CalendarDays, CheckCircle2, CircleAlert, CircleHelp, Compass, GripVertical, MapPin, MoreHorizontal, Pencil, Plane, Plus, Search, Share2, Trash2, UserPlus, Users, Utensils, Wallet, X } from "lucide-react";
import TripSharing, { memberLabel } from "@/components/trip-sharing";
import { TripTagFilter, TripTagList, TripTagsEditor } from "@/components/trip-tags";
import { useTripDrag } from "@/components/trip-drag";
import { hasEveryTag, tagKey } from "@/lib/trip-tags";
import { mutatePlanner } from "@/app/actions";
import { randomUuid } from "@/lib/uuid";
import { PLANNER_UPDATED } from "@/lib/planner-updated";
import { formatSavedDestinationLabel } from "@/lib/destination-label";
import { TransportationIcons } from "@/components/transportation-icons";
import TripMap from "@/components/trip-map";
import { connectionTarget, tripJourney } from "@/lib/trip-map";
import DestinationMap from "@/components/destination-map";
import { destinationPlaces, type SavedPlace } from "@/lib/destination-map";
import { MAIN_COLUMN, PAGE, type FrameWidths } from "@/lib/photo-sizes";
import { calculateBudget, calculateDestinationBudget, tripVisits, unsetStayAmount, unsetTripAmount, type EstimateCategory, type UnsetAmount } from "@/lib/budget";
import { formatCurrency, MAX_AMOUNT_DOLLARS, minorAmountValue } from "@/lib/money";
import { ShoppingBudgetEditor, FoodBudgetEditor, FoodSummary, ActivitiesBudgetEditor, ActivitiesSummary, AccommodationBudgetEditor, AccommodationSummary, CurrencyTotals, DestinationBudget, DestinationBudgetEditor, MiscellaneousBudgetEditor, StayNightsEditor, type KeepFocus } from "@/components/destination-budget";
import { RESTAURANT_TYPES } from "@/lib/types";
import type { FoodBudgetMode, ActivitiesBudgetMode, Budget, Candidate, Church, MassTime, Category, Destination, DestinationAccess, DestinationVisit, HomeItem, ItineraryStop, LibraryDestination, Mutation, PackingItem, ResearchLink, Snapshot, TravelLeg, Trip, TripAccess, TripStop } from "@/lib/types";

type Editor =
  | { kind: "trip"; item?: Trip }
  // A saved destination; with a stop it also edits that trip's stay.
  | { kind: "destination"; item: Destination; stop?: TripStop }
  // A city to add to the trip: last, or from a + between its cards, directly before the stop `before` (TRA-153). Only
  // the city is asked for.
  | { kind: "addStop"; before?: TripStop }
  // A destination outside any trip, from Destinations. Only its city is asked for.
  | { kind: "newDestination" }
  | { kind: "shoppingBudget"; item: Destination }
  // Accommodation's nightly estimate, and with a stop that trip's nights there.
  | { kind: "accommodationBudget"; item: Destination; stop?: TripStop }
  | { kind: "miscellaneousBudget"; item: Destination; nights: number | null }
  // One trip's nights at a destination.
  | { kind: "stayNights"; stop: TripStop }
  | { kind: "weather"; item: Destination }
  // A destination's monthly climate averages (TRA-135), apart from its typical weather.
  | { kind: "climate"; item: Destination }
  | { kind: "entryRequirements"; item: Destination }
  | { kind: "healthSafety"; item: Destination }
  | { kind: "activitiesBudget"; item: Destination }
  | { kind: "foodBudget"; item: Destination; nights: number | null }
  | { kind: "leg"; item: TravelLeg }
  // One layover's plan (TRA-45), saved apart from its connection.
  | { kind: "layover"; leg: TravelLeg; layover: ItineraryStop }
  // An idea's editor, which adds one to the destination without `item`. Opened from its details, Cancel and saving return there.
  // `deleting` shows a saved idea's Delete confirmation above it, which leaves the editor and its draft as they are (TRA-128).
  // `draft` is the unsaved changes an activity's dialog kept for it, which it opens with (TRA-160).
  | { kind: "candidate"; destinationId: string; category: Category; item?: Candidate; details?: true; deleting?: boolean; draft?: IdeaDraft }
  // An idea's details, read only, from its destination's carousels (TRA-120) and map (TRA-130). An activity's, and its
  // editor opened from them, step through its destination's activities (TRA-160).
  | { kind: "ideaDetails"; item: Candidate }
  // A church's details, read only, from its destination's map (TRA-130).
  | { kind: "churchDetails"; item: Church }
  | { kind: "church"; destinationId: string; item?: Church }
  | { kind: "homeItem"; item?: HomeItem }
  // A packing item's editor, which adds one to the trip's list without `item` (TRA-18).
  | { kind: "packingItem"; item?: PackingItem }
  // A review of packing recommendations, each new one with the ID it is added under (TRA-18).
  | { kind: "packingReview"; review: PackingReview }
  | { kind: "share" }
  | { kind: "delete"; mutation: Mutation; title: string; description: string; redirect?: string };
type CandidateEditor = Extract<Editor, { kind: "candidate" }>;
/**
 * An activity editor's unsaved changes, kept when its dialog steps to another activity (TRA-160): its fields as its form
 * held them, and its links and photos.
 */
type IdeaDraft = { fields: FormData; links: ResearchLink[]; gallery: GalleryDraft };
const categories: Category[] = ["hotels", "activities", "restaurants"];
const labels = { hotels: "Hotels", activities: "Activities", restaurants: "Restaurants" };
const singular = { hotels: "hotel", activities: "activity", restaurants: "restaurant" } as const;
const categoryIcons = { hotels: BedDouble, activities: Binoculars, restaurants: Utensils };
const descriptions = {
  hotels: "Find a place to make yourself at home.",
  activities: "Collect the things you would love to do.",
  restaurants: "A good trip deserves a few great meals.",
};
/** An example of what an idea is, for its editor's What it is (TRA-138). */
const ideaExamples = { hotels: "Boutique hotel", activities: "Historic cathedral", restaurants: "Traditional Italian restaurant" };
/** What a destination's page shows above its name until it has a tagline of its own (TRA-125). */
const DEFAULT_TAGLINE = "A place worth knowing";
/** What a trip's page shows above its name until it has a tagline of its own (TRA-134). */
const DEFAULT_TRIP_TAGLINE = "An adventure in the making";
function displayPrice(cents: number | null) { return cents === null ? "Not estimated" : formatCurrency(cents, "USD"); }
function BudgetValue({ budget }: { budget: Budget }) {
  return <><strong>{<CurrencyTotals totals={budget.totalsByCurrency} />}</strong>
    <span className={budget.complete ? "estimate-status complete" : "estimate-status"}>{budget.complete ? "Estimated total" : budget.knownCount ? "Partial estimate" : "Add a few prices to begin"}</span></>;
}
function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? "field wide" : "field"}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function Notes({ name = "notes", value = "" }: { name?: string; value?: string }) {
  return <Field label="Notes" wide><textarea name={name} defaultValue={value} maxLength={8000} rows={3} placeholder="Anything worth remembering…" /></Field>;
}
/**
 * An editor: the title and X at the top, then `children`, a form whose fields scroll above its Cancel and Save footer.
 * Opening it focuses its first field, or without one, the control marked `data-autofocus`. So does a new `view`, as
 * when an idea's details open its editor and saving returns to them. An editor opened to enter a budget's Not set or
 * Not estimated amount focuses that amount's field, named `focus`, instead (TRA-165). Editors don't use `autoFocus`:
 * React runs it before `showModal()`, while the fields can't take focus.
 * Send feedback is inside the dialog so it shows above the backdrop; opening it leaves this editor and its draft open.
 * So does Help, beside the X, which describes the page beneath rather than the editor (TRA-3).
 * A confirmation (`confirm`) is centered over a darker backdrop, and its title and message scroll together above its
 * buttons (TRA-32). One can open above an editor, which stays open beneath it with its draft (TRA-128).
 * Help, the X and Escape wait while saving, and then the X and Escape call `onClose`. Chrome closes a dialog anyway
 * after repeated Escapes or Android's back button, so `onClosed` follows the browser even while saving (TRA-81).
 */
function Dialog({ title, view, focus, confirm, children, busy, onClose, onClosed }: { title: string; view: string; focus?: string; confirm: boolean; children: ReactNode; busy: boolean; onClose: () => void; onClosed: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const dialog = ref.current; const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null; dialog?.showModal(); return () => { dialog?.close(); if (opener?.isConnected) opener.focus(); }; }, []);
  useEffect(() => { ref.current?.querySelector<HTMLElement>(focus ? `[name="${focus}"]` : "input:not([type=hidden]), select, textarea, [data-autofocus]")?.focus(); }, [view, focus]);
  return <dialog ref={ref} className={confirm ? "editor-dialog confirm-dialog" : "editor-dialog"} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} onClose={onClosed}>
    <div className="dialog-heading"><h2 id={titleId}>{title}</h2><div className="dialog-heading-tools"><HelpButton className="text-button" disabled={busy}><CircleHelp size={16} aria-hidden="true" />Help</HelpButton><button className="icon-button" aria-label="Close" onClick={onClose} disabled={busy}><X size={20} /></button></div></div>{children}<FeedbackButton />
  </dialog>;
}

function count(value: number, one: string, many: string) { return value + " " + (value === 1 ? one : many); }

/** What clearing a destination's monthly climate averages removes, and keeps (TRA-135). */
function climateClearing(label: string): string {
  return "This removes the monthly averages, with their source and reference years, for " + label + ", in every trip that visits it. Its other typical weather stays.";
}

/** Deleting a shared trip removes it for everyone it was shared with, so its confirmation says so. */
function sharedDeleteNote(access: TripAccess): string {
  return access.role === "owner" && access.sharedWith.length > 0 ? " Everyone you shared it with will lose it too." : "";
}

/**
 * Every planner page: the trip list (no IDs), a trip (`tripId`) and its idea pages (with `stopId`), and Destinations:
 * the list (`destinationList`), one destination (`destinationId`) and its idea pages. Idea pages name a `category`, or `church`.
 * A trip's page has the saved destinations its Add destination offers (`library`, TRA-142).
 */
export default function PlannerApp({ initialData, initialBudgets, access = {}, destinationAccess = {}, library = [], tripId, stopId, destinationId, category, church = false, destinationList = false }: { initialData: Snapshot; initialBudgets?: Record<string, Budget>; access?: Record<string, TripAccess>; destinationAccess?: Record<string, DestinationAccess>; library?: LibraryDestination[]; tripId?: string; stopId?: string; destinationId?: string; category?: Category; church?: boolean; destinationList?: boolean }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [lastInitial, setLastInitial] = useState(initialData);
  const [editor, setEditor] = useState<Editor | null>(null);
  // The field an editor opened from a budget's Not set or Not estimated amount focuses (TRA-165). Others focus their first.
  const [focusField, setFocusField] = useState<string>();
  const [saving, setSaving] = useState(false);
  // An idea's editor opened from its details returns there in the same render as the refreshed page, so the details
  // show what was saved. Until then it is still saving.
  const [returning, startReturning] = useTransition();
  const busy = saving || returning;
  // True while the page reloads to show a saved change, which finishes after `busy` ends.
  const [refreshing, startRefresh] = useTransition();
  const focusAfterSave = useFocusAfter(!busy && !refreshing);
  const [itinerary, setItinerary] = useState<ItineraryStop[]>([]);
  // The layover plan editor's draft (TRA-45): the saved plan, or a new one with every estimate at 0.
  const [layoverDraft, setLayoverDraft] = useState<LayoverPlanDraft>(() => layoverPlanDraft(undefined));
  const [massTimes, setMassTimes] = useState<MassTime[]>([]);
  const [researchLinks, setResearchLinks] = useState<ResearchLink[]>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  // The Health and safety editor's doctors and clinics for non-emergency care (TRA-172).
  const [medicalProviders, setMedicalProviders] = useState<MedicalProviderDraft[]>([]);
  const [destinationGallery, setDestinationGallery] = useState<GalleryDraft>(() => createGalleryDraft());
  const [candidateGallery, setCandidateGallery] = useState<GalleryDraft>(() => createGalleryDraft());
  // The trip editor's headline image and its crops (TRA-133), saved with the trip.
  const [tripImage, setTripImage] = useState<TripImageDraft>(null);
  // The ID of the item an editor adds, given once when it opens, so saving again after a response is lost changes that item instead of adding another.
  const [newId, setNewId] = useState("");
  // The open editor's form, and the unsaved changes an activity's dialog keeps for the activities it stepped away from
  // in their editors, until they're saved or canceled or the dialog closes (TRA-160).
  const editorForm = useRef<HTMLFormElement>(null);
  const drafts = useRef(new Map<string, IdeaDraft>());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  // The trip list's selected tag filters, as tag keys.
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const tripDragHelp = useId();
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
  /** A destination this page has, or an empty city for one it doesn't. */
  const placeOf = (destinationIdValue: string): Pick<Destination, "city" | "cityFromSuggestion"> => data.destinations.find((item) => item.id === destinationIdValue) ?? { city: "", cityFromSuggestion: false };
  /** A destination's selected hotel, whose whole-stay price replaces its general nightly estimate. */
  const selectedHotel = (destinationIdValue?: string) => data.candidates.find((item) => item.destinationId === destinationIdValue && item.category === "hotels" && item.included);
  const tripPlaces = (id: string) => data.stops.filter((item) => item.tripId === id).sort((a, b) => a.position - b.position).map((item) => placeOf(item.destinationId));
  const legName = (id: string | null, end: "from" | "to") => id === null ? (end === "from" ? (trip?.homeCity || "Departing city") : (trip?.returnCity ?? trip?.homeCity) || "Return city") : (formatSavedDestinationLabel(placeOf(stops.find((item) => item.id === id)?.destinationId ?? "")) || "Destination");
  /** The trips this account can open that visit a destination, with their stops there. */
  const visitsOf = (id: string) => data.stops.filter((item) => item.destinationId === id).flatMap((item) => data.trips.filter((visiting) => visiting.id === item.tripId).map((visiting) => ({ trip: visiting, stop: item })));
  /** An idea's Delete confirmation, the same from its page's list and from its editor (TRA-128). */
  const ideaDeletion = (item: Candidate) => ({ title: "Delete “" + item.name + "”?", description: "This idea will be removed from " + formatSavedDestinationLabel(placeOf(item.destinationId)) + ", in every trip that visits it." });
  /** Opens an editor, focused on its first field or on `field`. */
  const open = (value: Editor, field?: string) => {
    if (busy) return;
    // An activity's editor opens with the links and photos of the draft its dialog kept for it, if any (TRA-160).
    const draft = value.kind === "candidate" ? value.draft : undefined;
    if (value.kind === "leg") setItinerary(value.item.itinerary ?? []);
    if (value.kind === "layover") setLayoverDraft(layoverPlanDraft(value.leg.layoverPlans.find((plan) => plan.layoverId === value.layover.id)));
    if (value.kind === "leg" || value.kind === "candidate") setResearchLinks(draft?.links ?? value.item?.links ?? []);
    if (value.kind === "entryRequirements") setResearchLinks(value.item.entryRequirements?.sources ?? []);
    if (value.kind === "healthSafety") { setResearchLinks(value.item.healthSafety?.sources ?? []); setEmergencyContacts(value.item.healthSafety?.emergencyContacts ?? []); setMedicalProviders((value.item.healthSafety?.medicalProviders ?? []).map(providerDraft)); }
    if (value.kind === "church") setMassTimes(value.item?.massTimes ?? []);
    setDestinationGallery(createGalleryDraft(value.kind === "destination" ? value.item : undefined));
    setCandidateGallery(draft?.gallery ?? createGalleryDraft(value.kind === "candidate" || value.kind === "church" ? value.item : undefined));
    setTripImage(createTripImageDraft(value.kind === "trip" ? value.item?.image ?? null : null));
    setNewId(randomUuid());
    setFocusField(field);
    setEditor(value); setError(""); setMessage("");
  };
  /** The item a save is for: the saved one an editor changes, or the new one it adds. */
  const itemToSave = (item?: { id: string }) => item ? { id: item.id } : { id: newId, create: true as const };
  /** What a field of an idea's editor starts with: what an unsaved draft left in it (TRA-160), or its saved value. */
  const draftText = (value: CandidateEditor, name: string, saved: string) => value.draft ? String(value.draft.fields.get(name) ?? "") : saved;
  /** Whether a checkbox of an idea's editor starts checked: as an unsaved draft left it (TRA-160), or as saved. */
  const draftChecked = (value: CandidateEditor, name: string, saved: boolean) => value.draft ? value.draft.fields.has(name) : saved;
  /**
   * Forgets the open editor and its photo drafts, and the drafts an activity's dialog kept (TRA-160), keeping any error.
   * When the browser closes an editor while it saves, this lets the save's error show on the page and the next editor
   * open as a new dialog (TRA-81).
   */
  const forget = () => { setEditor(null); setDestinationGallery(createGalleryDraft()); setCandidateGallery(createGalleryDraft()); setTripImage(null); drafts.current.clear(); };
  const close = () => { if (!busy) { forget(); setError(""); } };
  /** Where saving or Cancel leaves an editor: an idea's editor opened from its details returns to them, and others close. */
  const detailsOf = (value: Editor | null): Editor | null => value?.kind === "candidate" && value.details && value.item ? { kind: "ideaDetails", item: value.item } : null;
  /** Cancel discards the draft: an idea's editor opened from its details returns there, and any other editor closes. */
  const cancel = () => { const details = detailsOf(editor); if (details) open(details); else close(); };
  /** An idea as the page last loaded it, so its details show what was saved once the page refreshes. */
  const latest = (item: Candidate) => data.candidates.find((saved) => saved.id === item.id) ?? item;
  /**
   * Where an activity's dialog is among its destination's activities, in the order its Activities carousel shows them
   * (TRA-160), or null when it has none to step to: for other ideas, a destination's only activity, and one no longer saved.
   */
  const stepsOf = (item: Candidate) => {
    const list = item.category === "activities" ? carouselOrder(data.candidates.filter((idea) => idea.destinationId === item.destinationId && idea.category === "activities")) : [];
    const index = list.findIndex((idea) => idea.id === item.id);
    return list.length > 1 && index >= 0 ? { list, index } : null;
  };
  /** Opens an idea's editor from its details, with the unsaved changes an activity's dialog kept for it, if any (TRA-160). */
  function editFromDetails(item: Candidate) {
    if (busy) return;
    const draft = drafts.current.get(item.id);
    drafts.current.delete(item.id);
    open({ kind: "candidate", destinationId: item.destinationId, category: item.category, item, details: true, draft });
  }
  /**
   * Shows the activity `step` places from the one an activity's dialog shows, without closing it (TRA-160): its details,
   * or from its editor, the other's editor. The editor's unsaved changes, links and photos included, stay with their
   * activity and come back when its editor opens again. Stepping saves nothing, and past either end changes nothing.
   */
  function stepActivity(step: -1 | 1) {
    const item = editor?.kind === "ideaDetails" || (editor?.kind === "candidate" && editor.details) ? editor.item : undefined;
    const steps = item && !busy ? stepsOf(item) : null;
    const next = steps?.list[steps.index + step];
    if (!item || !next) return;
    if (editor?.kind === "ideaDetails") open({ kind: "ideaDetails", item: next });
    else {
      drafts.current.set(item.id, { fields: new FormData(editorForm.current!), links: researchLinks, gallery: candidateGallery });
      editFromDetails(next);
    }
  }
  /** A place's details, from its marker on its destination's map or its place under Not on the map (TRA-130). */
  const viewPlace = (place: SavedPlace) => {
    if (place.category === "churches") {
      const church = data.churches.find((item) => item.id === place.id);
      if (church) open({ kind: "churchDetails", item: church });
    } else {
      const idea = data.candidates.find((item) => item.id === place.id);
      if (idea) open({ kind: "ideaDetails", item: idea });
    }
  };
  /**
   * Opens the editor that enters an unset amount, focused on its field (TRA-165): a connection's, the trip's for its entry
   * and visa fees (TRA-159), an idea's, or a stay's budget editor for its category. A stay's nights are in Accommodation's
   * editor, and otherwise in their own.
   */
  const enter = (unset: UnsetAmount) => {
    if (unset.kind === "leg") return open({ kind: "leg", item: unset.leg }, unset.field);
    if (unset.kind === "trip") return open({ kind: "trip", item: unset.trip }, unset.field);
    if (unset.kind === "idea") return open({ kind: "candidate", destinationId: unset.idea.destinationId, category: unset.idea.category, item: unset.idea }, "price");
    const { category, stop: stay, visit, field } = unset;
    open(category === "hotels" ? { kind: "accommodationBudget", item: visit, stop: stay }
      : field === "nights" ? { kind: "stayNights", stop: stay }
      : category === "activities" ? { kind: "activitiesBudget", item: visit }
      : category === "food" ? { kind: "foodBudget", item: visit, nights: visit.nights }
      : category === "shopping" ? { kind: "shoppingBudget", item: visit }
      : { kind: "miscellaneousBudget", item: visit, nights: visit.nights }, field);
  };
  /** What an unset amount's link adds, for screen readers, as its editor's field names it (TRA-165). */
  const unsetDescription = (unset: UnsetAmount) => {
    if (unset.kind === "leg") return (unset.field === "price" ? "the price of travel from " : "miscellaneous spending from ") + legName(unset.leg.fromId, "from") + " to " + legName(unset.leg.toId, "to");
    if (unset.kind === "trip") return "the trip's entry and visa fees";
    if (unset.kind === "idea") return "the price of " + unset.idea.name;
    const fields = { nights: "nights in ", hotelNightlyAmount: "the nightly hotel amount for ", activitiesGeneralAmount: "the general activities amount for ", foodDailyAmount: "the daily food amount for ", shoppingAmount: "the shopping amount for ", miscDailyAmount: "the daily miscellaneous amount for " };
    return fields[unset.field] + formatSavedDestinationLabel(unset.visit);
  };
  /**
   * A budget's Not set or Not estimated amount, or the trip estimate's count of them, as a link to the editor for `unset`
   * (TRA-165), or as text when there is nothing to enter. If a save replaces the link while it has keyboard focus,
   * `keepFocus` moves focus nearby.
   */
  const unsetControl = (unset: UnsetAmount | null, text: string, keepFocus: KeepFocus): ReactNode => unset
    ? <button ref={keepFocus} type="button" className="text-button unset-amount" onClick={() => enter(unset)}>{text}<span className="sr-only">: add {unsetDescription(unset)}</span></button>
    : text;
  // The trip estimate's heading takes keyboard focus when a save replaces the link that had it (TRA-165).
  const estimateHeading = useRef<HTMLHeadingElement>(null);
  const keepEstimateFocus = useFocusFallback(estimateHeading);
  /** A trip estimate category's Not set or Not estimated amount, or its count of them: a link to its first unset amount in route order (TRA-165). */
  const estimateUnset = (category: EstimateCategory, text: string) => unsetControl(trip ? unsetTripAmount(data, trip.id, category) : null, text, keepEstimateFocus);
  /** How many amounts a trip estimate category is missing, below its name. */
  const missingCount = (category: EstimateCategory, count: number) => count > 0 && <small>{estimateUnset(category, count + " not estimated")}</small>;
  /** The saved idea whose Delete confirmation shows above its editor (TRA-128). */
  const deleting = editor?.kind === "candidate" && editor.deleting ? editor.item : undefined;
  /** Shows or hides the Delete confirmation above an idea's editor, which keeps its draft either way. */
  const setDeleting = (value: boolean) => { if (!busy && editor?.kind === "candidate") { setEditor({ ...editor, deleting: value }); setError(""); } };
  /**
   * Returns to an idea's editor once the browser closes its Delete confirmation, even while deleting, so the editor shows
   * the delete's error and its Delete opens a new confirmation (TRA-81). It reads the current editor, which a finished
   * delete may already have closed.
   */
  const leaveDeleting = () => setEditor((current) => current?.kind === "candidate" ? { ...current, deleting: false } : current);
  /** Saves a change and refreshes the page, resolving to whether it was saved. A refused change shows its error. */
  async function perform(mutation: Mutation, success = "Changes saved.", redirect?: string, imageForm?: FormData): Promise<boolean> {
    if (busy) return false;
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await mutatePlanner(mutation, imageForm);
      if (!result.ok) { setError(result.error); return false; }
      // A deleted idea has no details to return to (TRA-128). An editor that closes forgets the drafts its dialog kept (TRA-160).
      const details = mutation.type === "candidate.delete" ? null : detailsOf(editor);
      const finish = () => { setEditor(details); setDestinationGallery(createGalleryDraft()); setCandidateGallery(createGalleryDraft()); setTripImage(null); if (!details) drafts.current.clear(); };
      if (details) startReturning(finish); else finish();
      setMessage(success);
      if ((mutation.type === "stop.add" || mutation.type === "stop.visit") && result.id) {
        // The trip's stop for the city or saved destination: the one added, or the one it already had, which opens instead.
        const visiting = stops.find((item) => item.id === result.id);
        if (visiting) setMessage("“" + formatSavedDestinationLabel(placeOf(visiting.destinationId)) + "” is already in this trip.");
        shownStop.current = result.id;
      }
      if (redirect) router.push(redirect);
      else if (mutation.type === "trip.save" && mutation.create) router.push("/trips/" + mutation.id);
      else if (mutation.type === "destination.create" && result.id) router.push("/destinations/" + result.id);
      else startRefresh(() => router.refresh());
      return true;
    } catch (failure) {
      // A page opened before a deploy whose build changed the save action's ID: retrying never works, reloading does.
      setError(unstable_isUnrecognizedActionError(failure) ? PLANNER_UPDATED : "We couldn't confirm that your changes were saved. Please try again.");
      return false;
    }
    finally { setSaving(false); }
  }
  /**
   * Saves a change made without an editor, such as Move down. Saving disables the control and the saved change can disable
   * or replace it, so once the page shows the change, `find`'s control takes focus: by default the same control, or an
   * enabled one beside it.
   */
  function saveFrom(control: HTMLButtonElement, mutation: Mutation, success: string, find: () => HTMLElement | null | undefined = () => controlOrNeighbor(control)) {
    focusAfterSave(find);
    void perform(mutation, success);
  }
  /**
   * Shows a trip in its new place in the account's own order at once and saves the order (TRA-16). If saving fails, the
   * trips go back as they were and the error shows. A trip moved from the keyboard keeps focus on its handle.
   */
  function placeTrip(id: string, index: number, keyboard: boolean) {
    const previous = data.trips;
    const trips = previous.filter((item) => item.id !== id);
    trips.splice(index, 0, previous.find((item) => item.id === id)!);
    setData((current) => ({ ...current, trips }));
    if (keyboard) focusAfterSave(() => document.querySelector<HTMLElement>(`[data-trip-id="${id}"] .trip-handle`));
    void perform({ type: "trip.order", tripIds: trips.map((item) => item.id) }, "Trip order saved.").then((saved) => {
      if (!saved) setData((current) => ({ ...current, trips: previous }));
    });
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
    // A city chosen from a suggestion is recorded as one, so it can be shown shorter (TRA-76).
    const cityFromSuggestion = fields.has("cityFromSuggestion") || undefined;
    switch (editor.kind) {
      case "delete": void perform(editor.mutation, "Removed from your notebook.", editor.redirect); break;
      case "trip": void perform({ type: "trip.save", ...itemToSave(editor.item), name: text("name"), tagline: text("tagline"), focus: text("focus"), startDate: text("startDate") || null, dateLabel: text("dateLabel"), homeCity: text("homeCity"), returnCity: fields.has("differentReturn") ? text("returnCity") : null, travelers: Number(text("travelers")), entryVisaFeesAmount: text("entryVisaFeesAmount"), notes: text("notes") }, undefined, undefined, tripImageForm(tripImage, editor.item?.image ?? null)); break;
      case "entryRequirements": {
        void perform({ type: "destination.entryRequirements", id: editor.item.id, requirements: entryRequirementsFromForm(fields, researchLinks) }, "Entry requirements saved.");
        break;
      }
      case "healthSafety": {
        void perform({ type: "destination.healthSafety", id: editor.item.id, healthSafety: healthSafetyFromForm(fields, emergencyContacts, researchLinks, medicalProviders) }, "Health and safety saved.");
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
      case "climate": void perform({ type: "destination.climate", id: editor.item.id, climate: monthlyClimateFromForm(fields) }, "Monthly averages saved."); break;
      case "destination": {
        const imageForm = galleryForm(destinationGallery, editor.item);
        const shared = { city: text("city"), cityFromSuggestion, tagline: text("tagline"), notes: text("notes"), miscDailyAmount: text("miscDailyAmount"), hotelNightlyAmount: text("hotelNightlyAmount"), activitiesBudgetMode: text("activitiesBudgetMode") as ActivitiesBudgetMode, activitiesGeneralAmount: text("activitiesGeneralAmount"), foodBudgetMode: text("foodBudgetMode") as FoodBudgetMode, foodDailyAmount: text("foodDailyAmount"), shoppingAmount: text("shoppingAmount") };
        const stay = { stay: text("stay"), nights };
        if (editor.stop) void perform({ type: "destination.save", id: editor.item.id, stopId: editor.stop.id, ...shared, ...stay }, "Destination saved. Review any new travel connections.", undefined, imageForm);
        else void perform({ type: "destination.save", id: editor.item.id, ...shared }, "Destination saved in every trip that visits it.", undefined, imageForm);
        break;
      }
      case "addStop": {
        // A saved destination chosen from the list is added by its ID (TRA-142); any other city by its name. Either goes
        // last, or before the stop whose + opened the editor (TRA-153).
        const destinationId = text("destinationId");
        const before = editor.before?.id;
        if (trip) void perform(destinationId ? { type: "stop.visit", tripId: trip.id, destinationId, before } : { type: "stop.add", tripId: trip.id, city: text("city"), cityFromSuggestion, before }, "Destination added. Review any new travel connections.");
        break;
      }
      case "newDestination": void perform({ type: "destination.create", city: text("city"), cityFromSuggestion }); break;
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
        if (trip) void perform({ type: "homeItem.save", ...itemToSave(editor.item), tripId: trip.id, name: text("name"), price: text("price"), notes: text("notes") }, "At home item saved.");
        break;
      }
      case "packingItem": {
        if (trip) void perform({ type: "packingItem.save", ...itemToSave(editor.item), tripId: trip.id, name: text("name"), category: text("category") as PackingCategory, quantity: Number(text("quantity")) }, "Packing item saved.");
        break;
      }
      // Only the recommendations still checked are added, under the IDs the review gave them.
      case "packingReview": {
        const items = chosenItems(editor.review, fields.getAll("recommended").map(String));
        if (trip) void perform({ type: "packingList.add", tripId: trip.id, items }, count(items.length, "item", "items") + " added to the packing list.");
        break;
      }
      case "share": {
        if (trip) void perform({ type: "trip.share", tripId: trip.id, email: text("email") }, "Shared with " + text("email").trim().toLowerCase() + ". Travel doesn't send email, so let them know.");
        break;
      }
      // Airline and flight number are sent even while hidden for transportation that isn't a flight, which keeps them (TRA-147).
      case "leg": void perform({ type: "leg.save", id: editor.item.id, method: text("method"), airline: text("airline"), flightNumber: text("flightNumber"), price: text("price"), miscAmount: text("miscAmount"), departure: text("departure"), arrival: text("arrival"), url: researchLinks[0]?.url ?? "", links: researchLinks, notes: text("notes"), itinerary }); break;
      case "layover": void perform({ type: "leg.layoverPlan", id: editor.leg.id, layoverId: editor.layover.id, plan: layoverPlanFromDraft(layoverDraft) }, "Layover plan saved."); break;
      case "church": {
        void perform({ type: "church.save", ...itemToSave(editor.item), destinationId: editor.destinationId, name: text("name"), address: text("address"), denomination: text("denomination"), url: text("url"), massTimes, coordinates: coordinatesFromForm(fields, editor.item?.coordinates ?? null) }, "Church saved.", undefined, galleryForm(candidateGallery, editor.item));
        break;
      }
      case "candidate": {
        const imageForm = galleryForm(candidateGallery, editor.item);
        // A restaurant's editor sends every type checked, so unchecking them all clears them. Other ideas have none.
        const checkedTypes = fields.getAll("restaurantTypes");
        void perform({ type: "candidate.save", ...itemToSave(editor.item), destinationId: editor.destinationId, category: editor.category, name: text("name"), description: text("description"), price: text("price"), address: text("address"), url: researchLinks[0]?.url ?? "", links: researchLinks, notes: text("notes"), included: fields.has("included"), mustDo: fields.has("mustDo"), coordinates: coordinatesFromForm(fields, editor.item?.coordinates ?? null),
          ...(editor.category === "restaurants" && { restaurantTypes: RESTAURANT_TYPES.filter((type) => checkedTypes.includes(type)) }),
          // An activity's editor sends its estimated time, so clearing it removes it (TRA-170). Other ideas have none.
          ...(editor.category === "activities" && { estimatedMinutes: text("estimatedMinutes") === "" ? null : Number(text("estimatedMinutes")) }) }, "Changes saved.", undefined, imageForm);
        break;
      }
    }
  }
  const pageTitle = editor?.kind === "delete" ? editor.title : editor?.kind === "trip" ? (editor.item ? "Edit trip" : "A new adventure")
    : editor?.kind === "church" ? (editor.item ? "Edit church" : "Add a church")
    : editor?.kind === "entryRequirements" ? "Edit entry requirements"
    : editor?.kind === "healthSafety" ? "Edit health and safety"
    : editor?.kind === "weather" ? "Edit typical weather"
    : editor?.kind === "climate" ? (editor.item.climate ? "Edit monthly averages" : "Add monthly averages")
    : editor?.kind === "destination" ? "Edit destination: " + formatSavedDestinationLabel(editor.item)
    : editor?.kind === "addStop" ? "Add a destination" + (editor.before ? " before " + formatSavedDestinationLabel(placeOf(editor.before.destinationId)) : "")
    : editor?.kind === "newDestination" ? "New destination"
    // A destination's budget editors name it, since the trip estimate opens them too (TRA-165).
    : editor?.kind === "shoppingBudget" ? "Edit shopping budget for " + formatSavedDestinationLabel(editor.item)
    : editor?.kind === "accommodationBudget" ? "Edit accommodation budget for " + formatSavedDestinationLabel(editor.item)
    : editor?.kind === "miscellaneousBudget" ? "Edit miscellaneous budget for " + formatSavedDestinationLabel(editor.item)
    : editor?.kind === "stayNights" ? "Edit destination nights for " + formatSavedDestinationLabel(placeOf(editor.stop.destinationId))
    : editor?.kind === "foodBudget" ? "Edit food budget for " + formatSavedDestinationLabel(editor.item)
    : editor?.kind === "activitiesBudget" ? "Edit activities budget for " + formatSavedDestinationLabel(editor.item)
    : editor?.kind === "leg" ? "Plan this connection"
    : editor?.kind === "layover" ? "Layover in " + editor.layover.place
    : editor?.kind === "homeItem" ? (editor.item ? "Edit home item" : "Add an item at home")
    : editor?.kind === "packingItem" ? (editor.item ? "Edit packing item" : "Add a packing item")
    : editor?.kind === "packingReview" ? "Packing recommendations"
    : editor?.kind === "share" ? "Share this trip"
    : editor?.kind === "candidate" ? (editor.item ? "Edit " : editor.category === "activities" ? "Add " : "Add a ") + singular[editor.category]
    : editor?.kind === "ideaDetails" ? latest(editor.item).name
    : editor?.kind === "churchDetails" ? editor.item.name : "";
  /**
   * The + above a trip's destination card `index`, or below its last card (TRA-153). It opens Add destination to add a
   * destination there: directly before that card, or last. With a mouse it shows while the pointer is over it or a card
   * beside it, or it has keyboard focus; touchscreens always show it.
   */
  function renderStopInsertion(index: number) {
    const next = visits[index];
    const label = next ? "Add a destination before " + formatSavedDestinationLabel(next.visit) : "Add a destination after " + formatSavedDestinationLabel(visits[index - 1].visit);
    return <div className="stop-insertion" key={next ? "insert-" + next.stop.id : "insert-last"}><button type="button" className="button secondary" aria-label={label} onClick={() => open({ kind: "addStop", before: next?.stop })}><Plus size={16} aria-hidden="true" /></button></div>;
  }
  /**
   * A destination's Church section. In a trip, that stay's dates decide whether it can appear and which Sundays it lists.
   * `photoFrame` is how wide each church's photo is: across the page on its Church page, or a destination's card (TRA-154).
   */
  function renderChurch(place: Destination, photoFrame: FrameWidths, stay?: TripStop) {
    if (stay && !churchDateEligible(stay)) return null;
    // Show Church and Hide Church replace each other, so saving one focuses the other by the ID they share. It names the
    // stay when there is one: a trip the schema 21 upgrade left visiting a city twice has a Church section on both cards.
    const toggle = "church-visibility-" + (stay?.id ?? place.id);
    const findToggle = () => document.getElementById(toggle);
    const label = formatSavedDestinationLabel(place);
    if (!place.churchEnabled) return <div className="church-visibility"><p className="helper">Church is hidden. Saved churches and photos are kept.</p><button type="button" id={toggle} className="text-button" disabled={busy} onClick={(event) => saveFrom(event.currentTarget, { type: "destination.churchVisibility", id: place.id, enabled: true }, "Church shown.", findToggle)}>Show Church<span className="sr-only"> for {label}</span></button></div>;
    // The Sundays and church headings are h5, below this h4 (TRA-95). On a destination's card its heading opens and closes
    // them; on its Church page, where `church` is set, they are the page and always show (TRA-169).
    return <ChurchSection label={label} collapsible={!church} actions={<div className="heading-actions"><button type="button" className="text-button" disabled={busy} onClick={() => open({ kind: "church", destinationId: place.id })}><Plus size={15} />Add church</button><button type="button" id={toggle} className="text-button" disabled={busy} onClick={(event) => saveFrom(event.currentTarget, { type: "destination.churchVisibility", id: place.id, enabled: false }, "Church hidden. Your churches and photos are saved.", findToggle)}>Hide Church</button></div>}>
      {stay && <ChurchSundays destination={stay} headingLevel={5} />}
      <ChurchOptions items={data.churches.filter((item) => item.destinationId === place.id)} headingLevel={5} photoFrame={photoFrame} busy={busy} onAdd={() => open({ kind: "church", destinationId: place.id })} onEdit={(item) => open({ kind: "church", item, destinationId: place.id })} onDelete={(item) => confirmDelete({ type: "church.delete", id: item.id, destinationId: place.id }, "Delete “" + item.name + "”?", "This church and its photos will be removed from this destination, in every trip that visits it.")} />
    </ChurchSection>;
  }
  /** A destination's Hotels, Activities, Restaurants or Church page, from a trip's stop or from Destinations. */
  function renderIdeas(place: Destination, stay: TripStop | undefined, back: { href: string; label: string }) {
    const visit: DestinationVisit = { ...place, nights: stay?.nights ?? null };
    const pages = stay ? "/trips/" + stay.tripId + "/destinations/" + stay.id : "/destinations/" + place.id;
    const label = formatSavedDestinationLabel(place);
    return <>
      <Link href={back.href} className="breadcrumb"><ArrowLeft size={16} />{back.label}</Link>
      <section className="ideas-heading"><div><p className="eyebrow">{label.toUpperCase()} · THE POSSIBILITIES</p><h1>{category ? labels[category] : "Church"}</h1><p className="hero-description">{category ? descriptions[category] : "Keep church options and Mass times for your visit."}</p></div>{!category && place.churchEnabled && (!stay || churchDateEligible(stay)) && <button className="button primary" disabled={busy} onClick={() => open({ kind: "church", destinationId: place.id })}><Plus size={17} />Add church</button>}</section>
      <nav className="category-tabs" aria-label="Destination ideas">{categories.map((kind) => { const Icon = categoryIcons[kind]; return <Link key={kind} href={pages + "/" + kind} className={category === kind ? "selected" : ""} aria-current={category === kind ? "page" : undefined}><Icon size={18} />{labels[kind]}<span>{data.candidates.filter((item) => item.destinationId === place.id && item.category === kind).length}</span></Link>; })}</nav>
      {church && <><p className="helper">{stay ? "Church plans are managed on this destination’s trip card." : "Church plans are managed on this destination’s page."} Mass times are manually recorded and have not been verified.</p>{renderChurch(place, PAGE, stay)}{stay && !churchDateEligible(stay) && <p className="helper">This stay does not include Sunday. Saved churches and photos are kept for future plans.</p>}</>}
      {category && <>
      {category === "hotels" && <section className="hotel-budget-panel" aria-label="Accommodation budget"><div className="section-heading"><h2>Accommodation budget</h2><button className="button secondary small" onClick={() => open({ kind: "accommodationBudget", item: place, stop: stay })}><Pencil size={15} />{stay ? "Edit estimate & nights" : "Edit nightly estimate"}</button></div><AccommodationSummary snapshot={data} destination={visit} /></section>}
      {category === "activities" && <section className="hotel-budget-panel" aria-label="Activities budget"><div className="section-heading"><h2>Activities budget</h2><button className="button secondary small" onClick={() => open({ kind: "activitiesBudget", item: place })}><Pencil size={15} />Edit activities budget</button></div><ActivitiesSummary snapshot={data} destination={place} /><p className="helper">{place.activitiesBudgetMode === "general" ? "Your general amount supplies the budget. Activity selections are saved for itemized mode." : "Only included activity costs supply the budget. Your general amount stays saved."} Adding, editing, or removing activities never switches methods.</p></section>}
      {category === "restaurants" && <section className="hotel-budget-panel" aria-label="Food budget"><div className="section-heading"><h2>Food budget</h2><div className="heading-actions"><button className="button secondary small" onClick={() => open({ kind: "foodBudget", item: place, nights: visit.nights })}><Pencil size={15} />Edit food budget</button>{stay && <button className="button secondary small" onClick={() => open({ kind: "stayNights", stop: stay })}><CalendarDays size={15} />Edit destination nights</button>}</div></div><FoodSummary snapshot={data} destination={visit} /><p className="helper">{place.foodBudgetMode === "daily" ? "Your daily subtotal supplies the budget. Restaurant selections are saved for itemized mode." : "Only included restaurant costs supply the budget. Your daily amount stays saved."} Adding, editing, or removing restaurants never switches methods.</p></section>}
      {!stay && category !== "activities" && <p className="helper">Nights belong to each trip, so stay totals here wait for one. Each trip’s pages for this destination show its own.</p>}
      <div className="list-intro"><p>{category === "hotels" ? "Choose one hotel to replace the general estimate. Uncheck it to restore the estimate." : category === "activities" ? "Save ideas and choose which to include when using itemized activity costs." : "Save ideas and choose which to include when using itemized restaurant costs."} Ideas and selections are shared by every trip that visits {label}.</p><span>Prices in USD · whole party</span></div>
      {data.candidates.filter((item) => item.destinationId === place.id && item.category === category).length === 0 && <div className="empty-state ideas-empty"><h3>{category === "hotels" ? "A good night's sleep starts here." : category === "activities" ? "Leave a little room for discovery." : "Something delicious to look forward to."}</h3><p>Save your first {singular[category]} idea for {label}.<br />You can add a price now or come back to it later.</p></div>}
      <CandidateList items={data.candidates.filter((item) => item.destinationId === place.id && item.category === category)} category={category} destination={place} busy={busy}
        onEdit={(item) => open({ kind: "candidate", destinationId: place.id, category, item })}
        onDelete={(item) => { const { title, description } = ideaDeletion(item); confirmDelete({ type: "candidate.delete", id: item.id }, title, description); }}
        onMutate={(mutation, success, control) => saveFrom(control, mutation, success)} />
      </>}
    </>;
  }
  /**
   * A destination's Hotels, Activities and Restaurants sections, below its budget (TRA-120). In a trip, `stay` is its
   * stop, whose nights the accommodation and food budget editors use, and whose idea pages the sections link to.
   */
  function renderIdeaSections(place: Destination, stay?: TripStop) {
    return <DestinationIdeas ideas={data.candidates.filter((item) => item.destinationId === place.id)} city={formatSavedDestinationLabel(place)} busy={busy}
      pages={stay ? "/trips/" + stay.tripId + "/destinations/" + stay.id : "/destinations/" + place.id}
      onView={(item) => open({ kind: "ideaDetails", item })}
      onAdd={(kind) => open({ kind: "candidate", destinationId: place.id, category: kind })}
      onBudgetEdit={(kind) => open(kind === "hotels" ? { kind: "accommodationBudget", item: place, stop: stay } : kind === "activities" ? { kind: "activitiesBudget", item: place } : { kind: "foodBudget", item: place, nights: stay?.nights ?? null })}
      onMustDo={(item, control) => saveFrom(control, { type: "candidate.mustDo", id: item.id, mustDo: !item.mustDo }, item.mustDo ? "Must do removed." : "Marked as must do.")} />;
  }
  /**
   * An idea's details, read only, with Close and Edit where an editor has Cancel and Save. Edit opens its editor, which
   * returns here. An activity's have Previous and Next, and swipe, while its destination has others (TRA-160); each
   * activity's start at the top.
   */
  function renderIdeaDetails(item: Candidate) {
    const steps = renderActivitySteps(item);
    return <>{steps}{steps ? <SwipeBody key={item.id} onStep={stepActivity}><IdeaDetails item={item} /></SwipeBody> : <div className="dialog-body"><IdeaDetails item={item} /></div>}
      <div className="dialog-footer"><div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Close</button><button type="button" className="button primary" data-autofocus onClick={() => editFromDetails(item)}><Pencil size={15} aria-hidden="true" />Edit</button></div></div></>;
  }
  /** Previous and Next in an activity's dialog, while its destination has other activities to step to (TRA-160). */
  function renderActivitySteps(item: Candidate) {
    const steps = stepsOf(item);
    return steps && <ActivitySteps index={steps.index} count={steps.list.length} name={item.name} disabled={busy} onStep={stepActivity} />;
  }
  /** A church's details, read only, with Close (TRA-130). Its card in the Church section edits it. */
  function renderChurchDetails(item: Church) {
    return <><div className="dialog-body"><ChurchDetails item={item} /></div>
      <div className="dialog-footer"><div className="dialog-actions"><button type="button" className="button secondary" data-autofocus onClick={close}>Close</button></div></div></>;
  }
  /** One destination's page in Destinations: its shared research, and the trips that visit it with each stay's estimate. */
  function renderDestination(place: Destination) {
    const label = formatSavedDestinationLabel(place);
    const placeAccess = destinationAccess[place.id];
    const stays = visitsOf(place.id);
    return <>
      <Link href="/destinations" className="breadcrumb"><ArrowLeft size={16} />All destinations</Link>
      <section className="trip-heading"><div><p className="eyebrow">{(place.tagline || DEFAULT_TAGLINE).toUpperCase()}</p><h1>{label}</h1><div className="trip-meta">{label !== place.city && <span><MapPin size={17} />{place.city}</span>}<span><Plane size={17} />{stays.length ? "In " + count(new Set(stays.map((visit) => visit.trip.id)).size, "trip", "trips") : "Not in a trip"}</span>{placeAccess?.role === "editor" && <span><Share2 size={17} />{"Shared by " + memberLabel(placeAccess.owner)}</span>}</div>{place.notes && <p className="trip-notes">{place.notes}</p>}</div>
        <div className="heading-actions"><button className="button secondary" onClick={() => open({ kind: "destination", item: place })}><Pencil size={15} />Edit destination</button>{placeAccess?.role === "owner" && stays.length === 0 && <button className="icon-button" aria-label="Delete destination" onClick={() => confirmDelete({ type: "destination.delete", id: place.id }, "Delete this destination?", "“" + label + "” and everything saved for it will be removed: its hotels, activities, restaurants, churches, photos, notes, budget amounts, entry requirements, health and safety, and typical weather with its monthly averages.", "/destinations")}><Trash2 size={18} /></button>}</div>
      </section>
      <div className="trip-layout"><div className="trip-main">
        <article className="destination-card" id={"destination-" + place.id}><DestinationGallery destination={place} />
          <DestinationMap destination={place} places={destinationPlaces(data, place.id)} onView={viewPlace} />
          <DestinationBudget snapshot={data} visit={{ ...place, nights: null }} onShoppingEdit={() => open({ kind: "shoppingBudget", item: place })} onMiscellaneousEdit={() => open({ kind: "miscellaneousBudget", item: place, nights: null })} />
          {renderIdeaSections(place)}
          <EntryRequirementsPanel requirements={place.entryRequirements} disabled={busy} onEdit={() => open({ kind: "entryRequirements", item: place })} onClear={() => confirmDelete({ type: "destination.entryRequirements", id: place.id, requirements: null }, "Clear entry requirements?", "This removes the recorded requirements, sources, and last checked date for " + label + ", in every trip that visits it.")} />
          <HealthSafetyPanel healthSafety={place.healthSafety} disabled={busy} onEdit={() => open({ kind: "healthSafety", item: place })} onClear={() => confirmDelete({ type: "destination.healthSafety", id: place.id, healthSafety: null }, "Clear health and safety?", "This removes the local emergency number, recorded advisories, precautions, safety guidance, emergency contacts, non-emergency medical providers, sources, and last checked date for " + label + ", in every trip that visits it.")} />
          <TypicalWeatherPanel weather={place} disabled={busy} onEdit={() => open({ kind: "weather", item: place })} onEditClimate={() => open({ kind: "climate", item: place })} onClearClimate={() => confirmDelete({ type: "destination.climate", id: place.id, climate: null }, "Clear monthly averages?", climateClearing(label))} />
          {renderChurch(place, MAIN_COLUMN)}
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
  const visibleTrips = data.trips.filter((item) => hasEveryTag(item.tags, filterTags) && [item.name, item.dateLabel, ...tripPlaces(item.id).flatMap((place) => [place.city, formatSavedDestinationLabel(place)])].join(" ").toLowerCase().includes(search.toLowerCase()));
  // Trips move only while every trip shows, so the list is the account's whole order (TRA-16).
  const filtered = search !== "" || filterTags.length > 0;
  const tripDrag = useTripDrag(visibleTrips, placeTrip, !filtered && visibleTrips.length > 1 && !busy && !refreshing);
  const visibleDestinations = data.destinations.filter((item) => [item.city, formatSavedDestinationLabel(item), ...visitsOf(item.id).map((visit) => visit.trip.name)].join(" ").toLowerCase().includes(search.toLowerCase()));
  /** Same-named cities can share a short label, so the list shows their full saved names. */
  const sharesLabel = (item: Destination) => data.destinations.some((other) => other.id !== item.id && formatSavedDestinationLabel(other) === formatSavedDestinationLabel(item));

  // A trip's page is marked, so its spacing on phones changes without the pages that share its styles (TRA-156).
  return <div className="app-shell">
    <main id="main-content" className={trip && !stopId ? "main-content trip-page" : "main-content"}>
      {!tripId && !destinationId && !destinationList && <>
        <section className="home-hero"><div><p className="eyebrow">THE PLACES WE MIGHT GO</p><h1>Somewhere<br /><em>worth going.</em></h1><p className="hero-description">Big adventures, little escapes, and every possibility in between.<br className="desktop-break" /> Give your next idea a place to begin.</p>
          <button className="button primary" onClick={() => open({ kind: "trip" })}><Plus size={18} />New trip</button></div>
          <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><span className="art-n">N</span><Compass className="art-compass" size={132} strokeWidth={0.7} /><span className="art-note">a little room<br />for adventure</span><Plane className="art-plane" size={34} strokeWidth={1.3} /></div>
        </section>
        <section className="trips-section"><div className="section-heading"><div className="heading-inline"><h2>Your possibilities</h2><span className="count-pill">{data.trips.length}</span></div>
          {data.trips.length > 0 && <label className="search-field"><Search size={17} /><input aria-label="Search trips" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a trip or city" /></label>}</div>
          {data.tags.length > 0 && <TripTagFilter tags={data.tags} selected={filterTags} onToggle={toggleTagFilter} onClear={() => setTagFilter([])} />}
          {filtered && visibleTrips.length > 0 && data.trips.length > 1 && <p className="helper trip-order-note">Clear the search and tag filters to drag trips into a new order.</p>}
          <p id={tripDragHelp} className="sr-only">Drag to move this trip, or press Space, move it with the arrow keys, and press Space again to drop it. Escape cancels.</p>
          <p className="sr-only" aria-live="assertive" aria-atomic="true">{tripDrag.announcement}</p>
          {data.trips.length === 0 ? <div className="empty-state home-empty"><span className="empty-icon"><MapPin size={28} strokeWidth={1.5} /></span><h3>Every trip starts with a possibility.</h3><p>A weekend away? A place you have always wanted to see?<br />Add your first trip and work out the details as you go.</p><button className="button secondary" onClick={() => open({ kind: "trip" })}><Plus size={17} />Create your first trip</button></div>
            : visibleTrips.length === 0 ? <div className="empty-state"><h3>{!filterTags.length ? "No trips match that search." : search ? "No trips match that search and every selected tag." : "No trips have every selected tag."}</h3>{search && <button className="text-button" onClick={() => setSearch("")}>Clear search</button>}{filterTags.length > 0 && <button className="text-button" onClick={() => setTagFilter([])}>Clear tag filters</button>}</div>
            : <div className="trip-grid">{visibleTrips.map((item, index) => {
              const places = tripPlaces(item.id);
              const estimate = homeBudgets[item.id];
              const itemAccess = access[item.id];
              return <article className={"trip-card tone-" + (index % 3)} key={item.id} {...tripDrag.card(item.id)}>
                <Link className="trip-card-main" href={"/trips/" + item.id}><TripImageView trip={item} frame="card" /><div className="trip-card-top"><span className="trip-number">TRIP {String(index + 1).padStart(2, "0")}</span><Compass size={38} strokeWidth={1} /></div>
                  <h3>{item.name}</h3>{item.tagline && <p className="trip-tagline">{item.tagline}</p>}{item.focus && <p className="trip-focus"><strong>Focus:</strong> {item.focus}</p>}<p className="city-list"><MapPin size={15} />{places.length ? places.map((place) => formatSavedDestinationLabel(place)).join(" → ") : "Destinations to be decided"}</p>
                  <div className="trip-meta"><span><CalendarDays size={15} />{item.startDate ? formatCalendarDate(item.startDate) + " → " + formatCalendarDate(item.endDate) : item.dateLabel || "Whenever the time is right"}</span><span><Users size={15} />{item.travelers} {item.travelers === 1 ? "traveler" : "travelers"}</span>{itemAccess.role === "editor" && <span><Share2 size={15} />{"Shared by " + memberLabel(itemAccess.owner)}</span>}</div>
                  <TripTagList tags={item.tags} />
                  <div className="card-budget"><div><span className="small-label">ESTIMATED BUDGET</span><BudgetValue budget={estimate} /></div><span className="round-arrow"><ArrowRight size={19} /></span></div>
                </Link><div className="card-tools"><span className="card-tools-start"><button type="button" className="icon-button trip-handle" aria-label={"Reorder " + item.name} aria-describedby={tripDragHelp} {...tripDrag.handle(item.id)}><GripVertical size={16} aria-hidden="true" /></button><button className="text-button" aria-label={"Edit " + item.name} onClick={() => open({ kind: "trip", item })}><Pencil size={14} />Edit</button></span>{itemAccess.role === "owner" && <button className="icon-button muted" aria-label={"Delete " + item.name} onClick={() => confirmDelete({ type: "trip.delete", id: item.id }, "Delete “" + item.name + "”?", "This removes the trip, its travel plans, At home items, and packing list. Its destinations, with their saved ideas and research, stay in Destinations." + sharedDeleteNote(itemAccess))}><Trash2 size={15} /></button>}</div>
              </article>;
            })}</div>}
        </section>
      </>}

      {trip && !stopId && <>
        <Link href="/" className="breadcrumb"><ArrowLeft size={16} />All trips</Link>
        <TripImageView trip={trip} frame="banner" />
        <section className="trip-heading"><div><p className="eyebrow">{(trip.tagline || DEFAULT_TRIP_TAGLINE).toUpperCase()}</p><h1>{trip.name}</h1><div className="trip-meta"><span><CalendarDays size={17} />{trip.startDate ? formatCalendarDate(trip.startDate) + " → " + formatCalendarDate(trip.endDate) : trip.dateLabel || "Dates to be decided"}</span><span><Users size={17} />{trip.travelers} {trip.travelers === 1 ? "traveler" : "travelers"}</span><span><MapPin size={17} />{trip.homeCity ? "Departing: " + trip.homeCity : "Add departing city"}</span>{trip.returnCity && <span><MapPin size={17} />Returning: {trip.returnCity}</span>}{tripAccess?.role === "editor" && <span><Share2 size={17} />{"Shared by " + memberLabel(tripAccess.owner)}</span>}{tripAccess?.role === "owner" && tripAccess.sharedWith.length > 0 && <span><Share2 size={17} />{"Shared with " + tripAccess.sharedWith.length + (tripAccess.sharedWith.length === 1 ? " person" : " people")}</span>}</div>
          <TripTagsEditor tags={trip.tags} available={data.tags} busy={busy} onAdd={(name) => perform({ type: "trip.tag", tripId: trip.id, name }, "Tag added.")} onRemove={(name) => void perform({ type: "trip.untag", tripId: trip.id, name }, "Tag removed.")} />
          {trip.notes && <p className="trip-notes">{trip.notes}</p>}</div>
          <div className="heading-actions"><button className="button secondary" onClick={() => open({ kind: "trip", item: trip })}><Pencil size={15} />Edit trip</button>{tripAccess?.role === "owner" && <><button className="button secondary" onClick={() => open({ kind: "share" })}><UserPlus size={15} />Share</button><button className="icon-button" aria-label="Delete trip" onClick={() => confirmDelete({ type: "trip.delete", id: trip.id }, "Delete this trip?", "“" + trip.name + "”, its travel plans, At home items, and packing list will be removed. Its destinations, with their saved ideas and research, stay in Destinations." + sharedDeleteNote(tripAccess), "/")}><Trash2 size={18} /></button></>}</div>
        </section>
        <div className="trip-layout"><div className="trip-main">
          <TripMap tripId={trip.id} journey={tripJourney(data, trip.id)} />
          <section><div className="section-heading"><div><p className="eyebrow">ONE STOP AT A TIME</p><h2>The destinations</h2></div><button className="button secondary small" onClick={() => open({ kind: "addStop" })}><Plus size={16} />Add destination</button></div>
            {visits.length === 0 ? <div className="empty-state"><MapPin size={29} strokeWidth={1.4} /><h3>Where should this trip take you?</h3><p>Add your first destination. Your departure and return connections will appear automatically.</p><button className="text-button" onClick={() => open({ kind: "addStop" })}>Add a destination <ArrowRight size={16} /></button></div>
              : <div className="destination-list">{visits.map(({ stop: visitStop, visit }, index) => { const label = formatSavedDestinationLabel(visit); return [renderStopInsertion(index), <article className="destination-card" key={visitStop.id} id={"destination-" + visitStop.id} tabIndex={-1}><DestinationGallery destination={visit} /><div className="destination-top"><span className="stop-number">{String(index + 1).padStart(2, "0")}</span><div className="destination-name"><h3><Link href={"/destinations/" + visit.id}>{label}</Link></h3>{visit.tagline && <p className="tagline">{visit.tagline}</p>}<p className={visitStop.stay ? undefined : "unknown"}>{visitStop.stay || "Stay notes not added"}</p></div><div className="destination-tools"><button className="icon-button" disabled={busy || index === 0} aria-label={"Move " + label + " up"} onClick={(event) => saveFrom(event.currentTarget, { type: "stop.move", id: visitStop.id, direction: "up" }, "Route updated. Review the new travel connections.")}><ArrowUp size={15} /></button><button className="icon-button" disabled={busy || index === visits.length - 1} aria-label={"Move " + label + " down"} onClick={(event) => saveFrom(event.currentTarget, { type: "stop.move", id: visitStop.id, direction: "down" }, "Route updated. Review the new travel connections.")}><ArrowDown size={15} /></button><button className="icon-button" aria-label={"Edit " + label} onClick={() => open({ kind: "destination", item: visit, stop: visitStop })}><Pencil size={15} /></button><button className="icon-button" aria-label={"Remove " + label + " from this trip"} onClick={() => confirmDelete({ type: "stop.remove", id: visitStop.id }, "Remove “" + label + "” from this trip?", "Its hotels, activities, restaurants, photos, and research stay in Destinations and in any other trip. This trip’s nights, stay notes, and travel plans to and from it are removed, and the remaining route reconnects.")}><Trash2 size={15} /></button></div></div>
                {visit.notes && <p className="destination-notes">{visit.notes}</p>}
                {/* The card's photos come first, then its name, stay notes and notes, so its map follows them, before its budget (TRA-130). */}
                <DestinationMap destination={visit} places={destinationPlaces(data, visit.id)} onView={viewPlace} />
                <DestinationBudget snapshot={data} visit={visit} stop={visitStop} onShoppingEdit={() => open({ kind: "shoppingBudget", item: visit })} onMiscellaneousEdit={() => open({ kind: "miscellaneousBudget", item: visit, nights: visit.nights })} renderUnset={(category, text, keepFocus) => unsetControl(unsetStayAmount(data, visitStop, visit, category), text, keepFocus)} />
                {renderIdeaSections(visit, visitStop)}
                <EntryRequirementsPanel requirements={visit.entryRequirements} stay={visitStop} disabled={busy} onEdit={() => open({ kind: "entryRequirements", item: visit })} onClear={() => confirmDelete({ type: "destination.entryRequirements", id: visit.id, requirements: null }, "Clear entry requirements?", "This removes the recorded requirements, sources, and last checked date for " + label + ", in every trip that visits it.")} />
                <HealthSafetyPanel healthSafety={visit.healthSafety} disabled={busy} onEdit={() => open({ kind: "healthSafety", item: visit })} onClear={() => confirmDelete({ type: "destination.healthSafety", id: visit.id, healthSafety: null }, "Clear health and safety?", "This removes the local emergency number, recorded advisories, precautions, safety guidance, emergency contacts, non-emergency medical providers, sources, and last checked date for " + label + ", in every trip that visits it.")} />
                <TypicalWeatherPanel weather={visit} stay={visitStop} disabled={busy} onEdit={() => open({ kind: "weather", item: visit })} onEditClimate={() => open({ kind: "climate", item: visit })} onClearClimate={() => confirmDelete({ type: "destination.climate", id: visit.id, climate: null }, "Clear monthly averages?", climateClearing(label))} />
                {renderChurch(visit, MAIN_COLUMN, visitStop)}
              </article>]; })}{renderStopInsertion(visits.length)}</div>}
            {visits.length > 1 && <p className="helper">Use the arrows to change your route. Affected travel connections will need new details.</p>}
            {visits.length > 0 && <p className="helper">A destination’s ideas, research, photos, selections, and budget amounts are shared with every trip that visits it, and with Destinations. Each trip keeps its own nights, dates, stay notes, and travel connections.</p>}
          </section>
          <section className="travel-section"><div className="section-heading"><div><p className="eyebrow">GETTING THERE & BACK</p><h2>Between the places</h2></div><Plane size={25} strokeWidth={1.3} /></div>
            {visits.length === 0 ? <p className="section-description">Your travel connections will appear once you add a destination.</p> : <div className="travel-list">{tripLegs.map((leg) => <article className="travel-card" key={leg.id} id={connectionTarget(leg.id)} tabIndex={-1}><TransportationIcons method={leg.method} /><div className="travel-content"><h3>{legName(leg.fromId, "from")} <ArrowRight size={15} aria-hidden="true" /><span className="sr-only">to</span> {legName(leg.toId, "to")}</h3><p>{leg.method || "Travel details to be decided"}{leg.departure && " · " + leg.departure}{leg.arrival && " → " + leg.arrival}</p><FlightDetails leg={leg} />{leg.notes && <p className="preserve-lines">{leg.notes}</p>}<ResearchLinks links={leg.links ?? []} /><ConnectionItinerary legId={leg.id} stops={leg.itinerary ?? []} plans={leg.layoverPlans} disabled={busy} onPlan={(layover) => open({ kind: "layover", leg, layover })} onRemovePlan={(layover) => confirmDelete({ type: "leg.layoverPlan", id: leg.id, layoverId: layover.id, plan: null }, "Remove the layover plan for " + layover.place + "?", "Its flight times, airport time and activities are removed. The layover stays in the connection, and nothing else changes.")} /><span className={leg.priceCents === null ? "price unknown" : "price"}>{displayPrice(leg.priceCents)}{leg.priceCents === null && " · Needs estimate"}</span>{leg.miscCents !== null && <span className="price">Miscellaneous spending: {formatCurrency(leg.miscCents, "USD")}</span>}</div><div className="travel-tools"><button className="text-button" aria-label={"Edit travel from " + legName(leg.fromId, "from") + " to " + legName(leg.toId, "to")} onClick={() => open({ kind: "leg", item: leg })}><Pencil size={14} />Edit</button>{(leg.method || leg.airline || leg.flightNumber || leg.priceCents !== null || leg.miscCents !== null || leg.notes || leg.url || leg.departure || leg.arrival || (leg.itinerary?.length ?? 0) > 0 || (leg.links?.length ?? 0) > 0) && <button className="text-button muted" onClick={() => confirmDelete({ type: "leg.clear", id: leg.id }, "Clear this travel plan?", "The connection will remain in your route, with its price, miscellaneous spending, travel details, links, itinerary, and layover plans cleared.")}>Clear</button>}</div></article>)}</div>}
          </section>
          <HomeItems items={data.homeItems.filter((item) => item.tripId === trip.id)} busy={busy}
            onAdd={() => open({ kind: "homeItem" })}
            onEdit={(item) => open({ kind: "homeItem", item })}
            onDelete={(item) => confirmDelete({ type: "homeItem.delete", id: item.id, tripId: trip.id }, "Delete “" + item.name + "”?", "This removes the item and any cost from the trip estimate.")} />
          {/* The packing list (TRA-18): recommendations open a review of what isn't on the list yet, and a checkbox saves at once. */}
          <PackingList items={data.packingItems.filter((item) => item.tripId === trip.id)} busy={busy}
            onRecommend={() => open({ kind: "packingReview", review: packingReview(recommendPacking(data, trip.id), data.packingItems.filter((item) => item.tripId === trip.id), randomUuid) })}
            onAdd={() => open({ kind: "packingItem" })}
            onEdit={(item) => open({ kind: "packingItem", item })}
            onDelete={(item) => confirmDelete({ type: "packingItem.delete", id: item.id, tripId: trip.id }, "Delete “" + item.name + "”?", "This removes it from the packing list for everyone on this trip.")}
            onPack={(item, control) => { focusAfterSave(() => control); void perform({ type: "packingItem.pack", id: item.id, tripId: trip.id, packed: !item.packed }, "“" + item.name + "” marked " + (item.packed ? "not packed." : "packed.")); }} />
        </div>
        {budget && <aside className="budget-panel"><span className="budget-symbol"><Wallet size={23} strokeWidth={1.4} /></span><h2 ref={estimateHeading} tabIndex={-1}>The trip estimate</h2><div className="budget-total"><BudgetValue budget={budget} /></div><p className="budget-caption">Total for {trip.travelers === 1 ? "1 traveler" : "all " + trip.travelers + " travelers"}</p><dl className="budget-breakdown"><div><dt>Travel{missingCount("travel", budget.travelMissingCount)}</dt><dd>{tripLegs.some((leg) => leg.priceCents !== null) ? formatCurrency(budget.travelCents, "USD") : estimateUnset("travel", "Not estimated")}</dd></div><div><dt>Transit miscellaneous</dt><dd>{budget.transitMiscCents === null ? estimateUnset("transitMiscellaneous", "Not set") : formatCurrency(budget.transitMiscCents, "USD")}</dd></div><div><dt>Entry / visa fees</dt><dd>{budget.entryVisaFeesCents === null ? estimateUnset("entryVisaFees", "Not set") : formatCurrency(budget.entryVisaFeesCents, "USD")}</dd></div><div><dt>Hotels{missingCount("hotels", budget.hotelMissingCount)}</dt><dd><CurrencyTotals totals={budget.hotelsByCurrency} empty={estimateUnset("hotels", "Not estimated")} /></dd></div><div><dt>Activities{missingCount("activities", budget.activitiesMissingCount)}</dt><dd><CurrencyTotals totals={budget.activitiesByCurrency} empty={budget.activitiesMissingCount ? estimateUnset("activities", "Not estimated") : "$0"} /></dd></div><div><dt>Food{missingCount("food", budget.foodMissingCount)}</dt><dd><CurrencyTotals totals={budget.foodByCurrency} empty={budget.foodMissingCount ? estimateUnset("food", "Not estimated") : "$0"} /></dd></div><div><dt>Shopping</dt><dd><CurrencyTotals totals={budget.shoppingByCurrency} empty={estimateUnset("shopping", "Not set")} /></dd></div><div><dt>At home</dt><dd>{formatCurrency(budget.homeCents, "USD")}</dd></div><div><dt>Miscellaneous{missingCount("miscellaneous", budget.miscMissingCount)}</dt><dd><CurrencyTotals totals={budget.miscellaneousByCurrency} empty={estimateUnset("miscellaneous", "Not estimated")} /></dd></div></dl><div className="budget-note">{budget.complete ? <CheckCircle2 size={17} /> : <MoreHorizontal size={20} />}<p>{budget.complete ? "All required estimates are added." : budget.missingCount + " " + (budget.missingCount === 1 ? "detail still needs" : "details still need") + " an estimate or a choice."}</p></div></aside>}
        </div>
      </>}

      {trip && stop && destination && renderIdeas(destination, stop, { href: "/trips/" + trip.id + "#destination-" + stop.id, label: trip.name + " · " + formatSavedDestinationLabel(destination) })}

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
                <Link className="trip-card-main" href={"/destinations/" + item.id}><DestinationCardPhoto destination={item} /><div className="trip-card-top"><span className="trip-number">DESTINATION {String(index + 1).padStart(2, "0")}</span><MapPin size={34} strokeWidth={1} /></div>
                  <h3>{formatSavedDestinationLabel(item)}</h3>{sharesLabel(item) && <p className="destination-full-name">{item.city}</p>}
                  <p className="city-list"><Plane size={15} />{trips.length ? [...new Set(trips)].join(" · ") : "Not in a trip"}</p>
                  <div className="trip-meta"><span><BedDouble size={15} />{count(ideas("hotels"), "hotel", "hotels")}</span><span><Binoculars size={15} />{count(ideas("activities"), "activity", "activities")}</span><span><Utensils size={15} />{count(ideas("restaurants"), "restaurant", "restaurants")}</span>{itemAccess?.role === "editor" && <span><Share2 size={15} />{"Shared by " + memberLabel(itemAccess.owner)}</span>}</div>
                </Link>
              </article>;
            })}</div>}
        </section>
      </>}

      {!tripId && destination && !category && !church && renderDestination(destination)}

      {!tripId && destination && (category || church) && renderIdeas(destination, undefined, { href: "/destinations/" + destination.id, label: formatSavedDestinationLabel(destination) })}
      {!trip && tripId && <div className="empty-state"><h1>This trip is no longer here.</h1><Link href="/">Back to all trips</Link></div>}
      {!tripId && destinationId && !destination && <div className="empty-state"><h1>This destination is no longer here.</h1><Link href="/destinations">Back to all destinations</Link></div>}
      {message && <div className="toast" role="status"><CheckCircle2 size={17} />{message}<button aria-label="Dismiss message" className="icon-button" onClick={() => setMessage("")}><X size={14} /></button></div>}
      {/* Controls that save without an editor, such as Move or Include, can be far from the end of the page, so their errors stay in view like the toast. An editor shows its own above its buttons. */}
      {error && !editor && <div className="toast error-toast" role="alert"><CircleAlert size={17} aria-hidden="true" />{error}<button aria-label="Dismiss error" className="icon-button" onClick={() => setError("")}><X size={14} /></button></div>}
    </main>
    <footer className="site-footer"><span><Compass size={15} />For the trips still taking shape.</span><span>Shared editing · whole-party estimates</span></footer>
    {editor && <Dialog title={pageTitle} view={editor.kind} focus={focusField} confirm={editor.kind === "delete"} busy={busy} onClose={close} onClosed={forget}>{editor.kind === "ideaDetails" ? renderIdeaDetails(latest(editor.item)) : editor.kind === "churchDetails" ? renderChurchDetails(editor.item) : <form id="planner-editor" ref={editorForm} onSubmit={submit}>
      {/* An activity's editor opened from its details steps through its destination's activities too, each idea's fields starting afresh (TRA-160). */}
      {editor.kind === "candidate" && editor.details && editor.item && renderActivitySteps(latest(editor.item))}<div className="form-grid dialog-body" key={editor.kind === "candidate" ? editor.item?.id ?? newId : undefined}>
      {editor.kind === "delete" && <p className="delete-description wide">{editor.description} This cannot be undone.</p>}
      {editor.kind === "trip" && <>
        <Field label="Trip name" wide><input name="name" defaultValue={editor.item?.name} required maxLength={120} placeholder="A long weekend in the mountains" /></Field>
        <Field label="Tagline" hint="Shown in capitals above the trip’s name on its page. Leave it blank for the default." wide><input name="tagline" defaultValue={editor.item?.tagline} maxLength={120} placeholder={DEFAULT_TRIP_TAGLINE} /></Field>
        <Field label="Focus" hint="What the trip is mostly about, shown after “Focus:” on its card in All trips. Leave it blank to leave it off the card." wide><input name="focus" defaultValue={editor.item?.focus} maxLength={120} placeholder="History, architecture, local cuisine" /></Field>
        <Field label="General date" hint="Exact dates can wait."><input name="dateLabel" defaultValue={editor.item?.dateLabel} maxLength={120} placeholder="Spring 2027, or sometime soon" /></Field>
        <Field label="Trip start date" hint="Destination dates and the trip end are calculated from this date and each stay’s nights."><input name="startDate" type="date" min="0001-01-01" max="9999-12-31" defaultValue={editor.item?.startDate ?? ""} /></Field>
        <p className="helper wide">Trip end (calculated after saving): {formatCalendarDate(editor.item?.endDate)}</p>
        <Field label="Travelers"><input name="travelers" type="number" min="1" max="999" step="1" required defaultValue={editor.item?.travelers ?? 2} /></Field>
        {/* The trip's entry and visa fees (TRA-159), beside Travelers on wider screens, which the trip estimate's Not set opens. */}
        <Field label="Entry / visa fees (USD, optional)" hint="Visas, electronic travel authorizations and entry fees: one total for the whole party and every destination. Zero is accepted; leave blank to add no cost."><input name="entryVisaFeesAmount" type="number" className="no-spin-buttons" min="0" max={MAX_AMOUNT_DOLLARS} step="0.01" defaultValue={minorAmountValue(editor.item?.entryVisaFeesCents, "USD")} placeholder="Not set" /></Field>
        <TripRouteFields trip={editor.item} disabled={busy} />
        <TripImageEditor trip={editor.item} draft={tripImage} onChange={setTripImage} disabled={busy} />
        <Notes value={editor.item?.notes} />
      </>}
      {editor.kind === "destination" && <>
        <p className="helper wide">The city, tagline, budget amounts, photos, and notes are shared by every trip that visits this destination.{editor.stop && " Stay notes and nights are for this trip only."}</p>
        <LocationField compactDestination label="City or destination" name="city" defaultValue={editor.item.city} required disabled={busy} placeholder="Start typing a city, e.g. Vienna" helpText="Choose a suggestion or enter any destination." hint="Changing the city changes it in every trip that visits this destination, and clears travel details for its incoming and outgoing connections." />
        <Field label="Tagline" hint="Shown in capitals above the destination’s name on its page. Leave it blank for the default." wide><input name="tagline" defaultValue={editor.item.tagline} maxLength={120} placeholder={DEFAULT_TAGLINE} /></Field>
        {trip && editor.stop && <Field label="Stay notes" hint="For this trip only." wide><input name="stay" defaultValue={editor.stop.stay} maxLength={120} placeholder="3 nights, or sometime in May" /></Field>}
        <DestinationBudgetEditor stay={trip && editor.stop ? { trip, stops, stop: editor.stop } : undefined} destination={editor.item} selectedHotel={selectedHotel(editor.item.id)} disabled={busy} />
        <DestinationGalleryEditor destination={editor.item} draft={destinationGallery} onChange={setDestinationGallery} disabled={busy} />
        <Notes value={editor.item.notes} />
      </>}
      {/* A trip visits its owner's destinations, so the saved ones it offers, those the account can open, come with everything saved for them (TRA-142). */}
      {editor.kind === "addStop" && <LocationField compactDestination library={library} label="City or destination" name="city" required disabled={busy} placeholder="Start typing a city, e.g. Vienna" helpText="Choose a suggestion or enter any destination." hint={"A destination marked In your library is " + (tripAccess?.role === "editor" ? memberLabel(tripAccess.owner) + "’s, added" : "added") + " with everything saved for it. One already in this trip opens instead."} />}
      {editor.kind === "newDestination" && <LocationField compactDestination label="City or destination" name="city" required disabled={busy} placeholder="Start typing a city, e.g. Vienna" helpText="Choose a suggestion or enter any destination." hint="If you already have this destination, its page opens instead." />}
      {editor.kind === "church" && <ChurchEditor item={editor.item} massTimes={massTimes} onTimesChange={setMassTimes} gallery={candidateGallery} onGalleryChange={setCandidateGallery} busy={busy} />}
      {editor.kind === "entryRequirements" && <EntryRequirementsEditor requirements={editor.item.entryRequirements} sources={researchLinks} onSourcesChange={setResearchLinks} disabled={busy} />}
      {editor.kind === "healthSafety" && <HealthSafetyEditor healthSafety={editor.item.healthSafety} contacts={emergencyContacts} onContactsChange={setEmergencyContacts} providers={medicalProviders} onProvidersChange={setMedicalProviders} sources={researchLinks} onSourcesChange={setResearchLinks} disabled={busy} />}
      {editor.kind === "weather" && <TypicalWeatherEditor weather={editor.item} disabled={busy} />}
      {editor.kind === "climate" && <MonthlyClimateEditor climate={editor.item.climate} disabled={busy} />}
      {editor.kind === "shoppingBudget" && <ShoppingBudgetEditor destination={editor.item} disabled={busy} />}
      {editor.kind === "accommodationBudget" && <AccommodationBudgetEditor destination={editor.item} selectedHotel={selectedHotel(editor.item.id)} stay={trip && editor.stop ? { trip, stops, stop: editor.stop } : undefined} disabled={busy} />}
      {editor.kind === "miscellaneousBudget" && <MiscellaneousBudgetEditor destination={editor.item} nights={editor.nights} disabled={busy} />}
      {editor.kind === "stayNights" && trip && <StayNightsEditor stay={{ trip, stops, stop: editor.stop }} disabled={busy} />}
      {editor.kind === "foodBudget" && <FoodBudgetEditor destination={editor.item} nights={editor.nights} disabled={busy} />}
      {editor.kind === "activitiesBudget" && <ActivitiesBudgetEditor destination={editor.item} disabled={busy} />}
      {editor.kind === "leg" && <>
        <p className="form-route wide">{legName(editor.item.fromId, "from")} <ArrowRight size={16} aria-hidden="true" /><span className="sr-only">to</span> {legName(editor.item.toId, "to")}</p>
        <TransportationFields key={editor.item.id} leg={editor.item} />
        <Field label="Estimated price (USD)" wide hint="Total for the whole party for the full connection, including itinerary stops. Leave blank if unknown."><input name="price" type="number" className="no-spin-buttons" min="0" max={MAX_AMOUNT_DOLLARS} step="0.01" defaultValue={minorAmountValue(editor.item.priceCents, "USD")} placeholder="Not estimated" /></Field>
        <Field label="Miscellaneous spending (USD)" wide hint="Airport meals, drinks, snacks, and layover purchases: the total for the whole party for the full connection, including layovers, apart from its price. Leave blank if not estimated."><input name="miscAmount" type="number" className="no-spin-buttons" min="0" max={MAX_AMOUNT_DOLLARS} step="0.01" defaultValue={minorAmountValue(editor.item.miscCents, "USD")} placeholder="Not estimated" /></Field>
        <Field label="Departure"><input name="departure" defaultValue={editor.item.departure} maxLength={120} placeholder="Date, time, or general plan" /></Field>
        <Field label="Arrival"><input name="arrival" defaultValue={editor.item.arrival} maxLength={120} placeholder="Date, time, or general plan" /></Field>
        <ResearchLinksEditor links={researchLinks} onChange={setResearchLinks} disabled={busy} /><Notes value={editor.item.notes} />
        <ConnectionItineraryEditor stops={itinerary} onChange={setItinerary} planned={editor.item.layoverPlans.map((plan) => plan.layoverId)} disabled={busy} />
      </>}
      {editor.kind === "layover" && <>
        <p className="form-route wide">{legName(editor.leg.fromId, "from")} <ArrowRight size={16} aria-hidden="true" /><span className="sr-only">to</span> {legName(editor.leg.toId, "to")}</p>
        <LayoverPlanEditor place={editor.layover.place} draft={layoverDraft} onChange={setLayoverDraft} disabled={busy} />
      </>}
      {editor.kind === "homeItem" && <>
        <Field label="Name" wide><input name="name" defaultValue={editor.item?.name} required maxLength={160} placeholder="House sitting, babysitting, or another task" disabled={busy} /></Field>
        <Field label="Estimated price (USD, optional)" wide hint="Add the total cost for this trip, or leave blank if there is no cost to add. You can add a price later."><input name="price" type="number" className="no-spin-buttons" min="0" max={MAX_AMOUNT_DOLLARS} step="0.01" defaultValue={minorAmountValue(editor.item?.priceCents, "USD")} placeholder="No price added" disabled={busy} /></Field>
        <Field label="Notes" wide><textarea name="notes" defaultValue={editor.item?.notes} maxLength={8000} rows={3} placeholder="Contacts, arrangements, or anything to remember" disabled={busy} /></Field>
      </>}
      {editor.kind === "packingItem" && <PackingItemFields item={editor.item} disabled={busy} />}
      {editor.kind === "packingReview" && <PackingReviewFields review={editor.review} disabled={busy} />}
      {editor.kind === "share" && trip && tripAccess?.role === "owner" && <TripSharing access={tripAccess} busy={busy}
        onRemove={(member) => void perform({ type: "trip.unshare", tripId: trip.id, email: member.email }, member.email + " can no longer open this trip.")} />}
      {editor.kind === "candidate" && <>
        <Field label="Name" wide><input name="name" defaultValue={draftText(editor, "name", editor.item?.name ?? "")} required maxLength={160} placeholder={"Name of the " + singular[editor.category]} /></Field>
        <Field label="What it is" hint={"Shown below the " + singular[editor.category] + "’s name on its cards. Leave it blank for none."} wide><input name="description" defaultValue={draftText(editor, "description", editor.item?.description ?? "")} maxLength={120} placeholder={ideaExamples[editor.category]} /></Field>
        {editor.category === "restaurants" && <RestaurantTypesField types={editor.item?.restaurantTypes ?? []} disabled={busy} />}
        <Field label="Estimated price (USD)" wide hint={priceNotes[editor.category] + " Leave blank if unknown."}><input name="price" type="number" min="0" max={MAX_AMOUNT_DOLLARS} step="0.01" defaultValue={draftText(editor, "price", minorAmountValue(editor.item?.priceCents, "USD"))} placeholder="Not estimated" /></Field>
        {editor.category === "activities" && <Field label="Estimated time (minutes)" wide hint="About how long the activity takes, such as 90 for 1 hour 30 minutes. Leave blank if unknown."><input name="estimatedMinutes" type="number" inputMode="numeric" min="1" step="1" defaultValue={draftText(editor, "estimatedMinutes", String(editor.item?.estimatedMinutes ?? ""))} placeholder="Not estimated" /></Field>}
        <PlaceLocationFields label="Address or neighborhood" placeholder="Optional" address={editor.item?.address ?? ""} coordinates={editor.item?.coordinates ?? null} draft={editor.draft?.fields} disabled={busy} />
        <CandidateGalleryEditor candidate={editor.item} subject={singular[editor.category]} draft={candidateGallery} onChange={setCandidateGallery} disabled={busy} />
        <ResearchLinksEditor links={researchLinks} onChange={setResearchLinks} disabled={busy} /><Notes value={draftText(editor, "notes", editor.item?.notes ?? "")} />
        {editor.category !== "hotels" && <label className="checkbox-field wide"><input name="mustDo" type="checkbox" defaultChecked={draftChecked(editor, "mustDo", editor.item?.mustDo ?? false)} disabled={busy} /><span>Must do<small>A planning priority. Budget inclusion and list order stay separate.</small></span></label>}
        <label className="checkbox-field wide"><input name="included" type="checkbox" defaultChecked={draftChecked(editor, "included", editor.item?.included ?? false)} /><span>{selectionLabels[editor.category]}<small>{editor.category === "hotels" ? "Replaces the general estimate or other chosen hotel. Your general estimate stays saved." : editor.category === "activities" ? "Applies only in Itemized activity costs mode. This does not change your budgeting method." : "Applies only in Itemized restaurant costs mode. This does not change your budgeting method."}</small></span></label>
      </>}
    </div><div className="dialog-footer">{error && !deleting && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button secondary" onClick={cancel} disabled={busy}>Cancel</button>{editor.kind === "candidate" && editor.item && <button type="button" className="button danger editor-delete" onClick={() => setDeleting(true)} disabled={busy}>Delete</button>}{!(editor.kind === "packingReview" && editor.review.items.length === 0) && <button className={editor.kind === "delete" ? "button danger" : "button primary"} type="submit" disabled={busy}>{busy ? "Saving…" : editor.kind === "delete" ? (editor.mutation.type === "leg.clear" ? "Clear travel plan" : editor.mutation.type === "leg.layoverPlan" ? "Remove plan" : editor.mutation.type === "destination.entryRequirements" ? "Clear entry requirements" : editor.mutation.type === "destination.healthSafety" ? "Clear health and safety" : editor.mutation.type === "stop.remove" ? "Remove from trip" : "Delete") : editor.kind === "trip" && !editor.item ? "Create trip" : editor.kind === "addStop" ? "Add destination" : editor.kind === "newDestination" ? "Create destination" : editor.kind === "share" ? "Share" : editor.kind === "layover" ? "Save plan" : editor.kind === "packingReview" ? "Add chosen items" : "Save changes"}</button>}</div></div></form>}</Dialog>}
    {/* An idea's Delete confirmation, above its editor (TRA-128). It deletes the saved idea without saving the draft, which Cancel keeps. */}
    {deleting && <Dialog title={ideaDeletion(deleting).title} view="delete" confirm busy={busy} onClose={() => setDeleting(false)} onClosed={leaveDeleting}><div className="form-grid dialog-body"><p className="delete-description wide">{ideaDeletion(deleting).description} This cannot be undone.</p></div>
      <div className="dialog-footer">{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setDeleting(false)} disabled={busy}>Cancel</button><button type="button" className="button danger" onClick={() => void perform({ type: "candidate.delete", id: deleting.id }, "Removed from your notebook.")} disabled={busy}>{busy ? "Saving…" : "Delete"}</button></div></div></Dialog>}
  </div>;
}
