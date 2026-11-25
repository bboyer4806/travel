import { COORDINATE_ACCURACIES } from "./coordinates.ts";
import { EDITABLE_FIELDS } from "./editable-fields.ts";
import { ENTRY_REQUIREMENT_FIELDS } from "./entry-requirements.ts";
import { LAYOVER_BUFFERS, MAX_LAYOVER_ACTIVITIES, MAX_LAYOVER_MINUTES } from "./layover-plan.ts";
import { EMERGENCY_CONTACT_MAX_LENGTH, EMERGENCY_NUMBER_MAX_LENGTH, HEALTH_SAFETY_FIELDS, MAX_EMERGENCY_CONTACTS, MAX_SOURCES, MEDICAL_PROVIDER_MAX_LENGTH, PROVIDER_CHECKS, SHORT_NOTICE_CARE, US_ADVISORY_LEVELS, usAdvisoryLabel } from "./health-safety.ts";
import { AI_PHOTO_DOWNLOAD_SECONDS, formatMegabytes, MAX_AI_PROPOSAL_PHOTOS, MAX_CANDIDATE_IMAGES, MAX_DESTINATION_IMAGES, MAX_GALLERY_UPLOAD_BYTES, MAX_IMAGE_UPLOAD_BYTES } from "./image-limits.ts";
import { MAX_PACKING_ADD } from "./packing.ts";
import { MAX_TAG_LENGTH } from "./trip-tags.ts";
import { CLIMATE_LIMITS, MONTHS } from "./typical-weather.ts";
import { RESTAURANT_TYPES } from "./types.ts";
import type { EditableField } from "./editable-fields.ts";

/**
 * The tools Travel's MCP endpoint offers ChatGPT and Claude (TRA-115). The read tools see every trip and destination,
 * whoever owns them. `propose_changes` takes the planner's own changes (`Mutation` in types.ts), checked by the store
 * as an editor's saves are. Each save's editable fields are described from the contract the store checks them by
 * (`EDITABLE_FIELDS`, TRA-174), and the store refuses any property a change's schema doesn't list. A photo or headline
 * image change names each new image by the address Travel downloads it from, never by its bytes (TRA-122).
 */

const UUID = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
const DATE = "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$";
const id = (description: string) => ({ type: "string", pattern: UUID, description });
const text = (description: string, maxLength: number) => ({ type: "string", maxLength, description });
const amount = (description: string) => ({ type: "string", maxLength: 32, description: `${description} USD as text, such as "125.50", or "" when unknown.` });
const flag = (description: string) => ({ type: "boolean", description });
const direction = { type: "string", enum: ["up", "down"], description: "up moves it earlier, down later." };
const create = { type: "boolean", enum: [true], description: "true when this change adds the item, whose id is then a new UUID. Leave out to change a saved item." };
const link = (noun: string) => ({
  type: "object", additionalProperties: false, required: ["id", "url"],
  properties: { id: id(`The ${noun}'s id: a new UUID for a new one.`), url: text("Its https:// or http:// address.", 2048), description: text("What it is. Empty for none.", 160) },
});
const links = { type: "array", maxItems: 20, items: link("link"), description: "Research links, replacing the saved ones. Left out keeps them, with url as the first one's address." };
const sources = { type: "array", maxItems: 20, items: link("source"), description: "Where it was checked." };
const lastChecked = { type: ["string", "null"], pattern: DATE, description: "When it was last checked, YYYY-MM-DD, or null." };
/** A local date and time, as a layover plan's flights give them (TRA-45). */
const LOCAL_TIME = "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d$";
const minutes = (description: string) => ({ type: "integer", minimum: 0, maximum: MAX_LAYOVER_MINUTES, description });

/** A hotel's, activity's, restaurant's or church's coordinates for its destination's map (TRA-150, TRA-163), or null to remove them. */
const coordinates = {
  type: ["object", "null"], additionalProperties: false, required: ["latitude", "longitude", "accuracy"],
  properties: {
    latitude: { type: "number", minimum: -90, maximum: 90, description: "Degrees north, negative for south, such as 48.2485." },
    longitude: { type: "number", minimum: -180, maximum: 180, description: "Degrees east, negative for west, such as 15.3343." },
    accuracy: { type: "string", enum: COORDINATE_ACCURACIES, description: "exact when they mark the place itself; approximate when they only mark roughly where it is, as for a rental whose address is withheld. The map says a place is approximate, and never shows it as at an address." },
  },
  description: "Where the place is, or null to remove its coordinates. Its destination's map looks the place up by its address first, and shows it at these coordinates, however far it is from the destination, when no one place has its address or it has none. Give only coordinates from a source you can name, never guesses.",
};

function change(type: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return { type: "object", title: type, description, additionalProperties: false, properties: { type: { type: "string", enum: [type] }, ...properties }, required: ["type", ...required] };
}

/** How assistants are told about one of a record's editable fields (TRA-174), from the rules the store checks it by. */
function fieldSchema(field: EditableField): Record<string, unknown> {
  const { description } = field;
  switch (field.kind) {
    case "text": return { type: field.nullable ? ["string", "null"] : "string", ...(field.filled && { minLength: 1 }), maxLength: field.maxLength, description };
    case "url": return text(description, 2048);
    case "amount": return amount(description);
    case "boolean": return flag(description);
    case "whole": return { type: field.nullable ? ["integer", "null"] : "integer", minimum: field.min, ...(field.max !== undefined && { maximum: field.max }), description };
    case "number": return { type: ["number", "null"], description };
    case "choice": return { type: "string", enum: field.values, description };
    case "date": return { type: ["string", "null"], pattern: DATE, description };
  }
}
/** A record's editable fields as a schema's properties, and those of them a save must give: every one it can't leave out. */
export function fieldProperties(fields: Record<string, EditableField>): { properties: Record<string, unknown>; required: string[] } {
  const entries = Object.entries(fields);
  return { properties: Object.fromEntries(entries.map(([name, field]) => [name, fieldSchema(field)])), required: entries.filter(([, field]) => !field.keep).map(([name]) => name) };
}
/** A save: its own properties, such as its id, and every editable field of its records, from the contract (TRA-174). */
function save(type: string, description: string, properties: Record<string, unknown>, required: string[], ...records: Record<string, EditableField>[]) {
  const fields = records.map(fieldProperties);
  return change(type, description, Object.assign({}, properties, ...fields.map((field) => field.properties)), [...required, ...fields.flatMap((field) => field.required)]);
}

/**
 * A photo change's gallery (TRA-122): what the gallery editors change, with each new photo's https:// address for
 * Travel to download in place of a file. `main` is what the editor calls the photo shown first.
 */
function gallery(owner: string, maxImages: number, main: string, ordered: boolean) {
  return {
    type: "object", additionalProperties: false, required: ["add", "remove"],
    description: `The photo changes. A${owner === "idea" ? "n" : ""} ${owner} has up to ${maxImages} photos.`,
    properties: {
      add: {
        type: "array", maxItems: maxImages, description: "Photos to add, after the saved ones. Empty for none.",
        items: {
          type: "object", additionalProperties: false, required: ["id", "url"],
          properties: {
            id: id(`A new UUID for the photo, which mainImageId${ordered ? " and order" : ""} can name.`),
            url: text(`The https:// address of the image file itself, not of a page showing it: a JPEG, PNG or WebP image of up to ${formatMegabytes(MAX_IMAGE_UPLOAD_BYTES)} on a public website.`, 2048),
          },
        },
      },
      remove: { type: "array", maxItems: maxImages, items: id("A saved photo's id, from its images."), description: "Saved photos to remove. Empty for none." },
      mainImageId: { type: ["string", "null"], pattern: UUID, description: `The ${main} photo, saved or new. null only when no photos remain. Left out keeps the saved one, or the first remaining photo when it is removed.` },
      ...(ordered && { order: { type: "array", maxItems: maxImages, items: id("A photo's id."), description: "Every photo the destination keeps and adds, by id, in gallery order. Left out keeps the saved order, with new photos last." } }),
    },
  };
}

/** A packing item's editable fields (TRA-18), which each item a packing list add gives with its new id. */
const PACKING_ITEM = fieldProperties(EDITABLE_FIELDS.packing_items);

/** One of each of the planner's changes, as `propose_changes` takes them. */
const CHANGES = [
  save("trip.save", "Adds a trip, owned by Travel's owner, or changes a saved one. Each field is saved as given. A new departing or return city clears the travel from or to it. Its headline image changes only with trip.image.", {
    id: id("The trip's id, or a new UUID with create."), create,
  }, ["id"], EDITABLE_FIELDS.trips),
  change("trip.image", "Adds, replaces or removes a trip's headline image, and nothing else: the image across the top of its card on All trips and the banner on its page. A new image replaces any saved one and starts uncropped, centered at 100% in both, as in the trip editor, where only people crop it.", {
    id: id("The trip's id."),
    image: {
      type: ["object", "null"], additionalProperties: false, required: ["id", "url"],
      properties: {
        id: id("A new UUID for the image."),
        url: text(`The https:// address of the image file itself, not of a page showing it: a JPEG, PNG or WebP image of up to ${formatMegabytes(MAX_IMAGE_UPLOAD_BYTES)} on a public website.`, 2048),
      },
      description: "The new image, or null to remove the saved one.",
    },
  }, ["id", "image"]),
  change("trip.delete", "Deletes a trip with its stays, travel, At home items, packing list, tags and sharing. The destinations it visits stay, with everything saved for them.", { id: id("The trip's id.") }, ["id"]),
  change("trip.share", "Shares a trip with a Google account's email address, which can then sign in to Travel and change the trip. Nothing is sent to them.", { tripId: id("The trip's id."), email: text("Their Google account's email address.", 254) }, ["tripId", "email"]),
  change("trip.unshare", "Ends an account's access to a trip. The account can still sign in, and the trip is unchanged.", { tripId: id("The trip's id."), email: text("The email address it is shared with.", 254) }, ["tripId", "email"]),
  change("trip.tag", "Adds a tag to a trip, spelled as the same tag already is on another trip.", { tripId: id("The trip's id."), name: text("The tag.", MAX_TAG_LENGTH) }, ["tripId", "name"]),
  change("trip.untag", "Removes a tag from a trip. Other trips keep theirs.", { tripId: id("The trip's id."), name: text("The tag.", MAX_TAG_LENGTH) }, ["tripId", "name"]),
  save("homeItem.save", "Adds an At home item to a trip, such as house sitting or pausing the mail, or changes a saved one. Each field is saved as given.", {
    id: id("The item's id, or a new UUID with create."), create, tripId: id("Its trip's id."),
  }, ["id", "tripId"], EDITABLE_FIELDS.home_items),
  change("homeItem.delete", "Deletes an At home item.", { id: id("The item's id."), tripId: id("Its trip's id.") }, ["id", "tripId"]),
  save("packingItem.save", "Adds an item to a trip's packing list, one list shared by everyone who can open the trip, or changes a saved one's name, category and quantity. Each field is saved as given. Whether it is packed changes only with packingItem.pack: a new item starts not packed.", {
    id: id("The item's id, or a new UUID with create."), create, tripId: id("Its trip's id."),
  }, ["id", "tripId"], EDITABLE_FIELDS.packing_items),
  change("packingItem.pack", "Marks a packing item packed, or not packed, and changes nothing else.", { id: id("The item's id."), tripId: id("Its trip's id."), packed: flag("Whether it is packed.") }, ["id", "tripId", "packed"]),
  change("packingItem.delete", "Deletes an item from a trip's packing list.", { id: id("The item's id."), tripId: id("Its trip's id.") }, ["id", "tripId"]),
  change("packingList.add", `Adds up to ${MAX_PACKING_ADD} new items to a trip's packing list at once, none packed. Items already on the list stay as they are, so leave out any it already has.`, {
    tripId: id("The trip's id."),
    items: {
      type: "array", minItems: 1, maxItems: MAX_PACKING_ADD, description: "The items to add, each new.",
      items: { type: "object", additionalProperties: false, properties: { id: id("A new UUID for the item."), ...PACKING_ITEM.properties }, required: ["id", ...PACKING_ITEM.required] },
    },
  }, ["tripId", "items"]),
  save("destination.save", "Changes the fields given of a destination, in every trip that visits it. With stopId, also changes that trip's stay there: its stay notes and nights. Anything left out stays as it is. A new city clears the travel to and from it in every trip. Its weather fields summarize one time of year; averages for every month go in destination.climate. Its photos, its primary one included, change only with destination.photos.", {
    id: id("The destination's id."), stopId: id("A trip's stay at this destination, for stay and nights."),
  }, ["id"], EDITABLE_FIELDS.destinations, EDITABLE_FIELDS.trip_stops),
  change("destination.create", "Adds a destination outside any trip, owned by Travel's owner. A city the owner already has a destination for is that destination, unchanged.", { city: text("The city, with its region and country, such as \"Paris, Île-de-France, France\".", 120) }, ["city"]),
  change("destination.delete", "Deletes a destination no trip visits, with its ideas, churches, photos and research.", { id: id("The destination's id.") }, ["id"]),
  change("destination.entryRequirements", "Replaces a destination's entry requirements research, or clears it with null.", {
    id: id("The destination's id."),
    requirements: {
      type: ["object", "null"], additionalProperties: false,
      properties: { ...Object.fromEntries(ENTRY_REQUIREMENT_FIELDS.map((field) => [field.name, text(`${field.label}. Empty for none.`, field.maxLength)])), sources, lastCheckedDate: lastChecked },
      description: "The whole record, or null to clear it.",
    },
  }, ["id", "requirements"]),
  change("destination.healthSafety", "Replaces a destination's health and safety research, with its local emergency number, its emergency contacts and its doctors and clinics for non-emergency care, or clears it with null.", {
    id: id("The destination's id."),
    healthSafety: {
      type: ["object", "null"], additionalProperties: false, required: ["usAdvisoryLevel", "medicalProviders", "emergencyNumber"],
      properties: {
        usAdvisoryLevel: {
          type: ["integer", "null"], enum: [...US_ADVISORY_LEVELS, null],
          description: `The U.S. State Department's travel advisory level for the destination: ${US_ADVISORY_LEVELS.map(usAdvisoryLabel).join("; ")}. null when none is set, or it hasn't been checked against the State Department's current advisory: never a guess. Always given, the saved one to keep it. Apart from advisoryLevel, which stays as written.`,
        },
        ...Object.fromEntries(HEALTH_SAFETY_FIELDS.map((field) => [field.name, text(`${field.label}. Empty for none.`, field.maxLength)])),
        emergencyContacts: {
          type: "array", maxItems: MAX_EMERGENCY_CONTACTS, description: "Emergency services, embassies and other contacts.",
          items: { type: "object", additionalProperties: false, required: ["id", "name", "phone"], properties: { id: id("The contact's id: a new UUID for a new one."), name: text("Who.", EMERGENCY_CONTACT_MAX_LENGTH.name), phone: text("Digits, spaces, +, (, ), - and . only.", EMERGENCY_CONTACT_MAX_LENGTH.phone), notes: text("Notes. Empty for none.", EMERGENCY_CONTACT_MAX_LENGTH.notes) } },
        },
        sources, lastCheckedDate: lastChecked,
        medicalProviders: {
          type: "array",
          description: "Doctors, medical clinics and outpatient facilities for non-emergency care, such as a bad cold, an ear infection or a minor injury, replacing the saved ones. Emergency services belong in emergencyContacts instead. Prefer providers confirmed to offer consultations in English, found on the U.S. embassy's or consulate's list of medical providers, then on the provider's own website and other reliable sources; being on an embassy's list is no U.S. government endorsement. Include only providers worth keeping. Always given: the saved ones to keep them, or empty for none.",
          items: {
            type: "object", additionalProperties: false, required: ["id", "name", "englishConsultations", "visitingAmericans", "shortNotice"],
            properties: {
              id: id("The provider's id: a new UUID for a new one."),
              name: text("The doctor's, clinic's or facility's name.", MEDICAL_PROVIDER_MAX_LENGTH.name),
              address: text("Its address. Empty when unknown.", MEDICAL_PROVIDER_MAX_LENGTH.address),
              coordinates: {
                type: ["object", "null"], additionalProperties: false, required: ["latitude", "longitude"],
                properties: {
                  latitude: { type: "number", minimum: -90, maximum: 90, description: "Degrees north, negative for south." },
                  longitude: { type: "number", minimum: -180, maximum: 180, description: "Degrees east, negative for west." },
                },
                description: "Its map location, from a source you can name, or null: never a guess.",
              },
              phone: text("Its phone number: digits, spaces, +, (, ), - and . only. Empty when unknown.", MEDICAL_PROVIDER_MAX_LENGTH.phone),
              website: text("Its own website's https:// or http:// address. Empty when unknown.", MEDICAL_PROVIDER_MAX_LENGTH.website),
              services: text("Its medical specialty or services, such as general practice or pediatrics. Empty when unknown.", MEDICAL_PROVIDER_MAX_LENGTH.services),
              notes: text("Anything else worth knowing, such as hours or how to book. Empty for none.", MEDICAL_PROVIDER_MAX_LENGTH.notes),
              englishConsultations: { type: "string", enum: PROVIDER_CHECKS, description: "verified only when a source you cite confirms it offers medical consultations in English; otherwise unconfirmed." },
              visitingAmericans: { type: "string", enum: PROVIDER_CHECKS, description: "verified only when a source you cite confirms it sees visiting American patients; otherwise unconfirmed." },
              shortNotice: { type: "string", enum: SHORT_NOTICE_CARE, description: "The soonest visit a source you cite confirms it offers: walk-in visits without an appointment, same-day appointments, or short-notice appointments; otherwise unconfirmed. Never a guarantee that it can see anyone." },
              sources: { type: "array", maxItems: MAX_SOURCES, items: link("source"), description: "The pages its details come from, such as the embassy's list and its own website." },
              lastVerifiedDate: { type: ["string", "null"], pattern: DATE, description: "When its details were last checked, YYYY-MM-DD, or null." },
            },
          },
        },
        emergencyNumber: {
          type: ["object", "null"], additionalProperties: false, required: ["phone", "sourceUrl", "verifiedDate"],
          properties: {
            phone: text("The number to dial, such as 112 or 911: digits, spaces, +, (, ), - and . only.", EMERGENCY_NUMBER_MAX_LENGTH.phone),
            sourceUrl: text("The https:// or http:// address of the official or reliable page you cite that gives this number for the destination.", EMERGENCY_NUMBER_MAX_LENGTH.sourceUrl),
            verifiedDate: { type: "string", pattern: DATE, description: "When you verified the number on that page, YYYY-MM-DD." },
          },
          description: "The destination's primary local emergency number, which its section shows first with a button that calls it. Give it only from an official or reliable source you cite, such as a government, embassy or emergency service page covering the destination: never a guess, nor a number assumed to work everywhere. null when none is verified. Other emergency numbers belong in emergencyContacts. Always given: the saved one to keep it.",
        },
      },
      description: "The whole record, or null to clear it.",
    },
  }, ["id", "healthSafety"]),
  change("destination.climate", "Replaces a destination's monthly climate averages, which its Typical weather chart shows, or clears them with null. Its other typical weather stays. Give historical averages from one named source, such as a weather service's climate normals: never estimates, forecasts or values made up for a missing month.", {
    id: id("The destination's id."),
    climate: {
      type: ["object", "null"], additionalProperties: false, required: ["months", "source", "firstYear", "lastYear"],
      properties: {
        months: {
          type: "array", minItems: 12, maxItems: 12,
          description: "All 12 months, January to December, each once, named by its month, in any order, with every value given in °F and inches. They replace every saved month.",
          items: {
            type: "object", additionalProperties: false, required: ["month", "highF", "lowF", "precipitationIn"],
            properties: {
              month: { type: "string", enum: MONTHS, description: "The month these are the averages of, written in full." },
              highF: { type: "number", minimum: CLIMATE_LIMITS.minF, maximum: CLIMATE_LIMITS.maxF, description: "The month's average daily high in °F, at least lowF." },
              lowF: { type: "number", minimum: CLIMATE_LIMITS.minF, maximum: CLIMATE_LIMITS.maxF, description: "The month's average daily low in °F." },
              precipitationIn: { type: "number", minimum: 0, maximum: CLIMATE_LIMITS.maxPrecipitationIn, description: "The month's average total precipitation in inches." },
            },
          },
        },
        source: text("Where the averages are from: the source's name or its https:// address.", CLIMATE_LIMITS.sourceLength),
        firstYear: { type: "integer", minimum: CLIMATE_LIMITS.minYear, maximum: CLIMATE_LIMITS.maxYear, description: "The first year the averages cover, such as 1991." },
        lastYear: { type: "integer", minimum: CLIMATE_LIMITS.minYear, maximum: CLIMATE_LIMITS.maxYear, description: "The last year the averages cover, such as 2020, no earlier than firstYear." },
      },
      description: "The whole record, or null to clear it.",
    },
  }, ["id", "climate"]),
  change("destination.churchVisibility", "Shows or hides a destination's Church section.", { id: id("The destination's id."), enabled: flag("Whether it shows.") }, ["id", "enabled"]),
  save("church.save", "Adds a church to a destination, or changes a saved one. Each field is saved as given. Its coordinates change only with church.coordinates: a new address leaves any saved ones waiting to be reviewed, and its map doesn't use them until church.coordinates gives them again.", {
    id: id("The church's id, or a new UUID with create."), create, destinationId: id("Its destination's id."),
    massTimes: { type: "array", maxItems: 30, description: "Mass times, replacing the saved ones. Empty when unknown.", items: { type: "object", additionalProperties: false, required: ["id", "day", "time"], properties: { id: id("The Mass time's id: a new UUID for a new one."), day: text("A day, such as Sunday, or a date.", 120), time: text("The time.", 120) } } },
  }, ["id", "destinationId", "massTimes"], EDITABLE_FIELDS.churches),
  change("church.delete", "Deletes a church with its photos.", { id: id("The church's id."), destinationId: id("Its destination's id.") }, ["id", "destinationId"]),
  change("stop.add", "Adds a city to the end of a trip's route as a stay without nights: the trip owner's destination for the city, with everything saved for it, or a new one. A city the trip visits isn't added again. Its new ids are known only once approved, so set its nights in a later proposal. To add a destination the owner already has, whatever its city is called, use stop.visit.", { tripId: id("The trip's id."), city: text("The city, with its region and country.", 120) }, ["tripId", "city"]),
  change("stop.visit", "Adds one of the trip owner's saved destinations to the end of a trip's route as a stay without nights, with everything saved for it. A destination the trip visits isn't added again. Its new stay's id is known only once approved, so set its nights in a later proposal.", { tripId: id("The trip's id."), destinationId: id("The destination's id. Its owner must be the trip's.") }, ["tripId", "destinationId"]),
  change("stop.move", "Moves a stay one place earlier or later in its trip's route.", { id: id("The stay's id."), direction }, ["id", "direction"]),
  change("stop.remove", "Removes a trip's stay at a destination. The destination stays, with everything saved for it.", { id: id("The stay's id.") }, ["id"]),
  save("leg.save", "Changes the travel between two stays, or from the departing city or to the return city. Each field is saved as given. Its airline and flight number show only while its method names an airplane, such as Flight or Plane, and stay saved when it doesn't.", {
    id: id("The travel's id."),
    itinerary: { type: "array", maxItems: 30, description: "Layovers and stops on the way, replacing the saved ones. Left out keeps them. A layover this leaves out, or makes a stop, loses its plan.", items: { type: "object", additionalProperties: false, required: ["id", "kind", "place"], properties: { id: id("The entry's id: a new UUID for a new one."), kind: { type: "string", enum: ["layover", "stop"] }, place: text("Where.", 160), arrival: text("When it arrives. Empty for none.", 120), departure: text("When it leaves. Empty for none.", 120), notes: text("Notes. Empty for none.", 2000) } } },
    links,
  }, ["id"], EDITABLE_FIELDS.legs),
  change("leg.clear", "Clears everything saved for the travel between two stays, with its layovers' plans.", { id: id("The travel's id.") }, ["id"]),
  change("leg.layoverPlan", "Saves the plan of one layover in a travel's itinerary, replacing any saved one, or removes it with null. The layover and everything else about the travel stay. A plan times what the travelers will do during the layover against the flight that lands there and the connecting flight that departs, and Travel works out its schedule and warns when it runs past boarding or departure. Its minutes are estimates, never guarantees: give only times and estimates the travelers gave or from a source you can name, and 0 for any that doesn't apply. Removing the layover from the itinerary, or clearing the travel, removes its plan.", {
    id: id("The travel's id."), layoverId: id("The layover's id, from the travel's itinerary: an entry of kind layover, not another stop."),
    plan: {
      type: ["object", "null"], additionalProperties: false,
      required: ["timeZone", "arrival", "departure", ...LAYOVER_BUFFERS.map(({ name }) => name), "returnMinutes", "activities"],
      properties: {
        timeZone: text("The airport's IANA time zone, such as Europe/Berlin. Both flights' times are in it.", 64),
        arrival: { type: "string", pattern: LOCAL_TIME, description: "When the arriving flight is scheduled to land, as the airport's clocks show it: YYYY-MM-DDTHH:MM." },
        departure: { type: "string", pattern: LOCAL_TIME, description: "When the connecting flight is scheduled to depart, as the airport's clocks show it: YYYY-MM-DDTHH:MM, after arrival." },
        ...Object.fromEntries(LAYOVER_BUFFERS.map(({ name, label, hint }) => [name, minutes(`${label}: ${hint} In minutes, 0 when it doesn't apply.`)])),
        returnMinutes: { type: ["integer", "null"], minimum: 0, maximum: MAX_LAYOVER_MINUTES, description: "How long the travel back to the airport takes after the activities outside it, in minutes, or null when every activity is in the airport." },
        activities: {
          type: "array", maxItems: MAX_LAYOVER_ACTIVITIES,
          description: "The activities in the order they happen, replacing the saved ones. Empty for none. Those outside the airport come one after another, in one trip out of it. Airport activities listed before them come after immigration and customs, and the rest after security and the terminal transfer.",
          items: {
            type: "object", additionalProperties: false, required: ["id", "name", "outside", "minutes", "travelMinutes"],
            properties: {
              id: id("The activity's id: a new UUID for a new one."), name: text("What it is.", 160), place: text("Where it is, such as an address or a terminal. Empty for none.", 300),
              outside: flag("true when it is outside the airport, which means leaving the airport for it."),
              minutes: { type: "integer", minimum: 1, maximum: MAX_LAYOVER_MINUTES, description: "How long it takes, in minutes." },
              travelMinutes: { type: ["integer", "null"], minimum: 0, maximum: MAX_LAYOVER_MINUTES, description: "Outside the airport, how long getting there takes, from the airport or the activity before it, in minutes. null in the airport." },
              notes: text("Notes. Empty for none.", 2000),
            },
          },
        },
      },
      description: "The whole plan, or null to remove it.",
    },
  }, ["id", "layoverId", "plan"]),
  save("candidate.save", "Adds a hotel, activity or restaurant idea to a destination, or changes a saved one. Each field is saved as given. Including a hotel chooses it, leaving out the others. Its coordinates change only with candidate.coordinates: a new address leaves any saved ones waiting to be reviewed, and its map doesn't use them until candidate.coordinates gives them again.", {
    id: id("The idea's id, or a new UUID with create."), create, destinationId: id("Its destination's id."), category: { type: "string", enum: ["hotels", "activities", "restaurants"] },
    restaurantTypes: {
      type: "array", maxItems: RESTAURANT_TYPES.length, uniqueItems: true, items: { type: "string", enum: RESTAURANT_TYPES },
      description: "For restaurants only: the meals and visits it suits, any number of them, replacing the saved ones. Empty for none. Left out keeps them.",
    },
    links,
  }, ["id", "destinationId", "category"], EDITABLE_FIELDS.candidates),
  change("candidate.move", "Moves an idea one place up or down its list.", { id: id("The idea's id."), direction }, ["id", "direction"]),
  change("candidate.mustDo", "Marks an activity or restaurant Must do, or not.", { id: id("The idea's id."), mustDo: flag("Whether it is Must do.") }, ["id", "mustDo"]),
  change("candidate.include", "Includes an idea in the budget, or leaves it out. Including a hotel chooses it, leaving out the others.", { id: id("The idea's id."), included: flag("Whether it is included.") }, ["id", "included"]),
  change("candidate.delete", "Deletes an idea with its photos.", { id: id("The idea's id.") }, ["id"]),
  change("destination.photos", "Changes a destination's photos and nothing else: adds photos from their addresses, removes saved ones, chooses the primary photo and puts them in order. The primary photo is the destination's headline image, which its page shows first and its card in Destinations shows across its top. Removing it makes the first remaining photo primary, as in Travel's photo editor.", {
    id: id("The destination's id."), gallery: gallery("destination", MAX_DESTINATION_IMAGES, "primary", true),
  }, ["id", "gallery"]),
  change("candidate.photos", "Changes a hotel's, activity's or restaurant's photos and nothing else: adds photos from their addresses, removes saved ones and chooses the main photo. Its photos keep their saved order, with new photos last.", {
    id: id("The idea's id."), gallery: gallery("idea", MAX_CANDIDATE_IMAGES, "main", false),
  }, ["id", "gallery"]),
  change("church.photos", "Changes a church's photos and nothing else: adds photos from their addresses, removes saved ones and chooses the main photo. Its photos keep their saved order, with new photos last.", {
    id: id("The church's id."), gallery: gallery("church", MAX_CANDIDATE_IMAGES, "main", false),
  }, ["id", "gallery"]),
  change("candidate.coordinates", "Sets or removes a hotel's, activity's or restaurant's coordinates for its destination's map, and nothing else. Coordinates given are no longer waiting to be reviewed. To place many ideas, give one change for each.", {
    id: id("The idea's id."), coordinates,
  }, ["id", "coordinates"]),
  change("church.coordinates", "Sets or removes a church's coordinates for its destination's map, and nothing else. Coordinates given are no longer waiting to be reviewed.", {
    id: id("The church's id."), coordinates,
  }, ["id", "coordinates"]),
];

/** The properties each change an assistant can propose may have, by its type, as its schema lists them. The store refuses any other (TRA-174). */
export const CHANGE_FIELDS: Record<string, string[]> = Object.fromEntries(CHANGES.map((schema) => [schema.title, Object.keys(schema.properties)]));

const readOnly = { readOnlyHint: true, openWorldHint: false };
const noInput = { type: "object", properties: {}, additionalProperties: false };
const input = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

export const TOOLS = [
  {
    name: "list_trips", title: "List trips", annotations: readOnly, inputSchema: noInput,
    description: "Every trip in Travel, whoever owns it: its details, owner, who it is shared with, tags, and its stays in route order with their destinations. Other tools take the ids listed here.",
  },
  {
    name: "get_trip", title: "Get a trip", annotations: readOnly, inputSchema: input({ trip_id: id("The trip's id.") }),
    description: "One trip with everything on its page: its tagline, its headline image's version and crops in image, or null without one, which get_photo shows, stays, travel between them with a flight's airline and flightNumber and each layover's plan in layoverPlans, At home items, its packing list in packing, each item with its category, quantity for the whole party and whether it is packed, the destinations it visits with their hotels, activities, restaurants, churches and research, and its estimated budget. Amounts are whole USD cents for the whole party; null is not estimated. Each idea's and church's coordinates are null, or place it on its destination's map when its address isn't found or it has none, unless review is true: its address changed after they were saved, so the map doesn't use them.",
  },
  {
    name: "list_destinations", title: "List destinations", annotations: readOnly, inputSchema: noInput,
    description: "Every destination in Travel, whoever owns it: its city, owner, each trip's stay there, and how many hotels, activities, restaurants and churches it has. Each owner has one destination per city, shared by every trip of theirs that visits it.",
  },
  {
    name: "get_destination", title: "Get a destination", annotations: readOnly, inputSchema: input({ destination_id: id("The destination's id.") }),
    description: "One destination with everything on its page: its tagline, notes, budget amounts and methods, typical weather with its monthly climate averages, entry requirements, health and safety, photos with the primary one, its headline image, in mainImageId, hotels, activities, restaurants, churches, and each trip's stay there. Amounts are whole USD cents for the whole party. Each idea's and church's coordinates are null, or place it on the destination's map when its address isn't found or it has none, unless review is true: its address changed after they were saved, so the map doesn't use them. The map looks each place up by its address within 50 km of the destination, and one without usable coordinates by its name too.",
  },
  {
    name: "list_accounts", title: "List accounts", annotations: readOnly, inputSchema: noInput,
    description: "Every Google account that can sign in to Travel: its email and name, whether it has signed in yet, and which is Travel's designated owner.",
  },
  {
    name: "get_photo", title: "Get a photo", annotations: readOnly,
    inputSchema: input({ of: { type: "string", enum: ["trip", "destination", "idea", "church"], description: "What the photo is of: a trip, for its headline image, or a destination, idea or church." }, id: id("The trip's, destination's, idea's or church's id."), photo_id: id("The photo's id, from its images, or a trip headline image's version, from its image.") }),
    description: "One photo of a destination, idea or church, as listed in its images, or a trip's headline image.",
  },
  {
    name: "propose_changes", title: "Propose changes",
    // Open world: Travel downloads the photos a proposal adds from the addresses it gives (TRA-122).
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: "object", additionalProperties: false, required: ["summary", "changes"],
      properties: {
        summary: text("What the changes are for, in a line, shown to Travel's owner above them.", 200),
        changes: { type: "array", minItems: 1, maxItems: 50, items: { anyOf: CHANGES }, description: "The changes, at most 50, made in this order. A refusal names the change by its place in this list, from 1." },
      },
    },
    description: `Proposes changes to Travel for its owner to approve. Nothing changes until they do. Changes may apply to any trip or destination, whoever owns it, including deleting trips and changing who they are shared with. Each change is checked by Travel's own rules as it is proposed, in order, and the reply lists every record each one adds, changes or deletes, before and after. Give the owner the reply's approve_at link: there they approve or reject every change at once, within 24 hours. Approving makes all of them exactly as shown, or none if Travel has changed since. Check what they decided with get_change_proposal. Records are named by the ids the read tools list. A change that adds a trip, idea, church, At home item or packing item gives it a new UUID as its id, with create: true, and later changes in the same proposal can name it by that id. A change takes only the fields its schema lists. Coordinates change only with candidate.coordinates and church.coordinates, photos only with destination.photos, candidate.photos and church.photos, and a trip's headline image only with trip.image. Travel downloads each new photo and headline image from its address as it is proposed and checks it as it does an upload: at most ${MAX_AI_PROPOSAL_PHOTOS} new images and ${formatMegabytes(MAX_GALLERY_UPLOAD_BYTES)} in one proposal, downloaded within ${AI_PHOTO_DOWNLOAD_SECONDS} seconds, from public https:// addresses only. If any can't be downloaded or used, nothing is proposed, and the reply names its change and address. The owner sees every photo added, removed or rearranged, and each headline image's current and proposed images, before approving.`,
  },
  {
    name: "get_change_proposal", title: "Get a change proposal", annotations: readOnly, inputSchema: input({ proposal_id: id("The proposal_id propose_changes replied with.") }),
    description: "A proposal made with propose_changes: whether the owner approved it (applied), rejected it, approving it failed and why (failed, with nothing changed), or it is still pending or has expired.",
  },
];
