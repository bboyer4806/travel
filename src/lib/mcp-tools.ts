import { ENTRY_REQUIREMENT_FIELDS } from "./entry-requirements.ts";
import { EMERGENCY_CONTACT_MAX_LENGTH, HEALTH_SAFETY_FIELDS, MAX_EMERGENCY_CONTACTS } from "./health-safety.ts";
import { MAX_NIGHTS } from "./trip-dates.ts";
import { MAX_TAG_LENGTH } from "./trip-tags.ts";

/**
 * The tools Travel's MCP endpoint offers ChatGPT and Claude (TRA-115). The read tools see every trip and destination,
 * whoever owns them. `propose_changes` takes the planner's own changes (`Mutation` in types.ts), checked by the store
 * as an editor's saves are; these schemas only describe them to the assistant.
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

function change(type: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return { type: "object", title: type, description, additionalProperties: false, properties: { type: { type: "string", enum: [type] }, ...properties }, required: ["type", ...required] };
}

/** One of each of the planner's changes, as `propose_changes` takes them. */
const CHANGES = [
  change("trip.save", "Adds a trip, owned by Travel's owner, or changes a saved one. Each field is saved as given. A new departing or return city clears the travel from or to it.", {
    id: id("The trip's id, or a new UUID with create."), create, name: text("Its name.", 120),
    dateLabel: text("When, in words, such as \"Spring 2027\". Empty for none.", 120), homeCity: text("The departing city. Empty for none.", 120),
    returnCity: { type: ["string", "null"], maxLength: 120, description: "The return city, or null when it is the departing city. Left out keeps the saved one." },
    travelers: { type: "integer", minimum: 1, maximum: 999, description: "How many people travel." }, notes: text("Notes. Empty for none.", 8000),
    startDate: { type: ["string", "null"], pattern: DATE, description: "The first day, YYYY-MM-DD, or null for none. Each stay's dates follow from it and the nights before it. Left out keeps the saved one." },
  }, ["id", "name", "dateLabel", "homeCity", "travelers", "notes"]),
  change("trip.delete", "Deletes a trip with its stays, travel, At home items, tags and sharing. The destinations it visits stay, with everything saved for them.", { id: id("The trip's id.") }, ["id"]),
  change("trip.share", "Shares a trip with a Google account's email address, which can then sign in to Travel and change the trip. Nothing is sent to them.", { tripId: id("The trip's id."), email: text("Their Google account's email address.", 254) }, ["tripId", "email"]),
  change("trip.unshare", "Ends an account's access to a trip. The account can still sign in, and the trip is unchanged.", { tripId: id("The trip's id."), email: text("The email address it is shared with.", 254) }, ["tripId", "email"]),
  change("trip.tag", "Adds a tag to a trip, spelled as the same tag already is on another trip.", { tripId: id("The trip's id."), name: text("The tag.", MAX_TAG_LENGTH) }, ["tripId", "name"]),
  change("trip.untag", "Removes a tag from a trip. Other trips keep theirs.", { tripId: id("The trip's id."), name: text("The tag.", MAX_TAG_LENGTH) }, ["tripId", "name"]),
  change("homeItem.save", "Adds an At home item to a trip, such as house sitting or pausing the mail, or changes a saved one. Each field is saved as given.", {
    id: id("The item's id, or a new UUID with create."), create, tripId: id("Its trip's id."), name: text("What it is.", 160), price: amount("What it costs."),
    notes: text("Notes. Empty for none.", 8000), completed: flag("Whether it is done."),
  }, ["id", "tripId", "name", "price", "notes", "completed"]),
  change("homeItem.delete", "Deletes an At home item.", { id: id("The item's id."), tripId: id("Its trip's id.") }, ["id", "tripId"]),
  change("homeItem.complete", "Marks an At home item done, or not done.", { id: id("The item's id."), tripId: id("Its trip's id."), completed: flag("Whether it is done.") }, ["id", "tripId", "completed"]),
  change("destination.save", "Changes the fields given of a destination, in every trip that visits it. With stopId, also changes that trip's stay there: its stay notes and nights. Anything left out stays as it is. A new city clears the travel to and from it in every trip.", {
    id: id("The destination's id."), stopId: id("A trip's stay at this destination, for stay and nights."), city: text("The city.", 120), notes: text("Notes. Empty for none.", 8000),
    miscDailyAmount: amount("Daily miscellaneous spending for the whole party."), hotelNightlyAmount: amount("The nightly hotel estimate, used until a hotel is chosen."),
    activitiesBudgetMode: { type: "string", enum: ["itemized", "general"], description: "itemized adds up included activities; general uses activitiesGeneralAmount." },
    activitiesGeneralAmount: amount("The activities budget for a stay."),
    foodBudgetMode: { type: "string", enum: ["itemized", "daily"], description: "itemized adds up included restaurants; daily uses foodDailyAmount." },
    foodDailyAmount: amount("Daily food spending for the whole party."), shoppingAmount: amount("The shopping budget for a stay."),
    weatherHighF: { type: ["number", "null"], description: "Typical high in °F, or null." }, weatherLowF: { type: ["number", "null"], description: "Typical low in °F, or null." },
    weatherRainfall: text("Typical rainfall. Empty for none.", 4000), weatherPeriod: text("The weather's time of year. Empty for none.", 120), weatherSource: text("Where the weather is from. Empty for none.", 2048),
    stay: text("Stay notes for the trip's stay, with stopId. Empty for none.", 120),
    nights: { type: ["integer", "null"], minimum: 0, maximum: MAX_NIGHTS, description: "Nights of the trip's stay, with stopId, or null when unknown." },
  }, ["id"]),
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
  change("destination.healthSafety", "Replaces a destination's health and safety research, or clears it with null.", {
    id: id("The destination's id."),
    healthSafety: {
      type: ["object", "null"], additionalProperties: false,
      properties: {
        ...Object.fromEntries(HEALTH_SAFETY_FIELDS.map((field) => [field.name, text(`${field.label}. Empty for none.`, field.maxLength)])),
        emergencyContacts: {
          type: "array", maxItems: MAX_EMERGENCY_CONTACTS, description: "Emergency services, embassies and other contacts.",
          items: { type: "object", additionalProperties: false, required: ["id", "name", "phone"], properties: { id: id("The contact's id: a new UUID for a new one."), name: text("Who.", EMERGENCY_CONTACT_MAX_LENGTH.name), phone: text("Digits, spaces, +, (, ), - and . only.", EMERGENCY_CONTACT_MAX_LENGTH.phone), notes: text("Notes. Empty for none.", EMERGENCY_CONTACT_MAX_LENGTH.notes) } },
        },
        sources, lastCheckedDate: lastChecked,
      },
      description: "The whole record, or null to clear it.",
    },
  }, ["id", "healthSafety"]),
  change("destination.churchVisibility", "Shows or hides a destination's Church section.", { id: id("The destination's id."), enabled: flag("Whether it shows.") }, ["id", "enabled"]),
  change("church.save", "Adds a church to a destination, or changes a saved one. Each field is saved as given.", {
    id: id("The church's id, or a new UUID with create."), create, destinationId: id("Its destination's id."), name: text("Its name.", 160), address: text("Its address. Empty for none.", 500),
    denomination: text("Its denomination. Empty for none.", 160), url: text("Its website, https:// or http://. Empty for none.", 2048),
    massTimes: { type: "array", maxItems: 30, description: "Mass times, replacing the saved ones. Empty when unknown.", items: { type: "object", additionalProperties: false, required: ["id", "day", "time"], properties: { id: id("The Mass time's id: a new UUID for a new one."), day: text("A day, such as Sunday, or a date.", 120), time: text("The time.", 120) } } },
  }, ["id", "destinationId", "name", "address", "denomination", "url", "massTimes"]),
  change("church.delete", "Deletes a church with its photos.", { id: id("The church's id."), destinationId: id("Its destination's id.") }, ["id", "destinationId"]),
  change("stop.add", "Adds a city to the end of a trip's route as a stay without nights: the trip owner's destination for the city, with everything saved for it, or a new one. A city the trip visits isn't added again. Its new ids are known only once approved, so set its nights in a later proposal.", { tripId: id("The trip's id."), city: text("The city, with its region and country.", 120) }, ["tripId", "city"]),
  change("stop.move", "Moves a stay one place earlier or later in its trip's route.", { id: id("The stay's id."), direction }, ["id", "direction"]),
  change("stop.remove", "Removes a trip's stay at a destination. The destination stays, with everything saved for it.", { id: id("The stay's id.") }, ["id"]),
  change("leg.save", "Changes the travel between two stays, or from the departing city or to the return city. Each field is saved as given.", {
    id: id("The travel's id."), method: text("How, such as Flight or Train. Empty for none.", 120), price: amount("What it costs for the whole party."),
    departure: text("When it leaves. Empty for none.", 120), arrival: text("When it arrives. Empty for none.", 120), url: text("A booking or research link, https:// or http://. Empty for none.", 2048),
    notes: text("Notes. Empty for none.", 8000),
    itinerary: { type: "array", maxItems: 30, description: "Layovers and stops on the way, replacing the saved ones. Left out keeps them.", items: { type: "object", additionalProperties: false, required: ["id", "kind", "place"], properties: { id: id("The entry's id: a new UUID for a new one."), kind: { type: "string", enum: ["layover", "stop"] }, place: text("Where.", 160), arrival: text("When it arrives. Empty for none.", 120), departure: text("When it leaves. Empty for none.", 120), notes: text("Notes. Empty for none.", 2000) } } },
    links,
  }, ["id", "method", "price", "departure", "arrival", "url", "notes"]),
  change("leg.clear", "Clears everything saved for the travel between two stays.", { id: id("The travel's id.") }, ["id"]),
  change("candidate.save", "Adds a hotel, activity or restaurant idea to a destination, or changes a saved one. Each field is saved as given. Including a hotel chooses it, leaving out the others.", {
    id: id("The idea's id, or a new UUID with create."), create, destinationId: id("Its destination's id."), category: { type: "string", enum: ["hotels", "activities", "restaurants"] },
    name: text("Its name.", 160), price: amount("Its cost for the whole party: a hotel's for the whole stay."), address: text("Its address. Empty for none.", 500),
    url: text("A website, https:// or http://. Empty for none.", 2048), notes: text("Notes. Empty for none.", 8000), included: flag("Whether it is in the budget: for a hotel, whether it is the chosen one."),
    mustDo: flag("Must do, for activities and restaurants only. Left out keeps it."), links,
  }, ["id", "destinationId", "category", "name", "price", "address", "url", "notes", "included"]),
  change("candidate.move", "Moves an idea one place up or down its list.", { id: id("The idea's id."), direction }, ["id", "direction"]),
  change("candidate.mustDo", "Marks an activity or restaurant Must do, or not.", { id: id("The idea's id."), mustDo: flag("Whether it is Must do.") }, ["id", "mustDo"]),
  change("candidate.include", "Includes an idea in the budget, or leaves it out. Including a hotel chooses it, leaving out the others.", { id: id("The idea's id."), included: flag("Whether it is included.") }, ["id", "included"]),
  change("candidate.delete", "Deletes an idea with its photos.", { id: id("The idea's id.") }, ["id"]),
];

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
    description: "One trip with everything on its page: its stays, travel between them, At home items, the destinations it visits with their hotels, activities, restaurants, churches and research, and its estimated budget. Amounts are whole USD cents for the whole party; null is not estimated.",
  },
  {
    name: "list_destinations", title: "List destinations", annotations: readOnly, inputSchema: noInput,
    description: "Every destination in Travel, whoever owns it: its city, owner, each trip's stay there, and how many hotels, activities, restaurants and churches it has. Each owner has one destination per city, shared by every trip of theirs that visits it.",
  },
  {
    name: "get_destination", title: "Get a destination", annotations: readOnly, inputSchema: input({ destination_id: id("The destination's id.") }),
    description: "One destination with everything on its page: notes, budget amounts and methods, typical weather, entry requirements, health and safety, photos, hotels, activities, restaurants, churches, and each trip's stay there. Amounts are whole USD cents for the whole party.",
  },
  {
    name: "list_accounts", title: "List accounts", annotations: readOnly, inputSchema: noInput,
    description: "Every Google account that can sign in to Travel: its email and name, whether it has signed in yet, and which is Travel's designated owner.",
  },
  {
    name: "get_photo", title: "Get a photo", annotations: readOnly,
    inputSchema: input({ of: { type: "string", enum: ["destination", "idea", "church"], description: "What the photo is of." }, id: id("The destination's, idea's or church's id."), photo_id: id("The photo's id, from its images.") }),
    description: "One photo of a destination, idea or church, as listed in its images.",
  },
  {
    name: "propose_changes", title: "Propose changes",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object", additionalProperties: false, required: ["summary", "changes"],
      properties: {
        summary: text("What the changes are for, in a line, shown to Travel's owner above them.", 200),
        changes: { type: "array", minItems: 1, maxItems: 50, items: { anyOf: CHANGES }, description: "The changes, at most 50, made in this order. A refusal names the change by its place in this list, from 1." },
      },
    },
    description: "Proposes changes to Travel for its owner to approve. Nothing changes until they do. Changes may apply to any trip or destination, whoever owns it, including deleting trips and changing who they are shared with. Each change is checked by Travel's own rules as it is proposed, in order, and the reply lists every record each one adds, changes or deletes, before and after. Give the owner the reply's approve_at link: there they approve or reject every change at once, within 24 hours. Approving makes all of them exactly as shown, or none if Travel has changed since. Check what they decided with get_change_proposal. Records are named by the ids the read tools list. A change that adds a trip, idea, church or At home item gives it a new UUID as its id, with create: true, and later changes in the same proposal can name it by that id. Photos can't be added or changed.",
  },
  {
    name: "get_change_proposal", title: "Get a change proposal", annotations: readOnly, inputSchema: input({ proposal_id: id("The proposal_id propose_changes replied with.") }),
    description: "A proposal made with propose_changes: whether the owner approved it (applied), rejected it, approving it failed and why (failed, with nothing changed), or it is still pending or has expired.",
  },
];
