import { createStore } from "../src/lib/store.ts";

/** The designated owner that planning tests work as. Ownership, sharing and isolation are tested in sharing.test.mjs. */
export const OWNER_EMAIL = "owner@example.test";

/** Turns a schema 20 database back into schema 19, as before trip ownership and sharing, to test the upgrade. */
export const UNDO_SCHEMA_20 = `
  DROP TRIGGER trips_insert_owner; DROP TRIGGER trips_update_owner; DROP INDEX trips_owner;
  DROP TABLE trip_shares; ALTER TABLE trips DROP COLUMN ownerId; PRAGMA user_version = 19;`;

/**
 * Turns a schema 21 database back into schema 20, when each destination still belonged to one trip, to test
 * the upgrade. Every stop must share its destination's ID, as each destination added to a trip does.
 */
export const UNDO_SCHEMA_21 = `
  PRAGMA foreign_keys = OFF;
  DROP TRIGGER trip_stops_insert_owner; DROP TRIGGER trip_stops_update_owner;
  CREATE TABLE trip_destinations (
    id TEXT PRIMARY KEY, tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    city TEXT NOT NULL, stay TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL CHECK(position >= 0), arrivalDate TEXT, departureDate TEXT,
    miscDailyMinor INTEGER CHECK(miscDailyMinor BETWEEN 0 AND 9007199254740991), miscCurrency TEXT,
    hotelNightlyMinor INTEGER CHECK(hotelNightlyMinor BETWEEN 0 AND 9007199254740991), hotelCurrency TEXT,
    activitiesBudgetMode TEXT NOT NULL DEFAULT 'itemized' CHECK(activitiesBudgetMode IN ('itemized', 'general')),
    activitiesGeneralMinor INTEGER CHECK(activitiesGeneralMinor BETWEEN 0 AND 9007199254740991), activitiesCurrency TEXT,
    foodBudgetMode TEXT NOT NULL DEFAULT 'itemized' CHECK(foodBudgetMode IN ('itemized', 'daily')),
    foodDailyMinor INTEGER CHECK(foodDailyMinor BETWEEN 0 AND 9007199254740991), foodCurrency TEXT,
    shoppingMinor INTEGER CHECK(shoppingMinor BETWEEN 0 AND 9007199254740991), shoppingCurrency TEXT,
    weatherHighF REAL, weatherLowF REAL,
    weatherRainfall TEXT NOT NULL DEFAULT '', weatherPeriod TEXT NOT NULL DEFAULT '', weatherSource TEXT NOT NULL DEFAULT '',
    churchEnabled INTEGER NOT NULL DEFAULT 0 CHECK(churchEnabled IN (0,1)),
    nights INTEGER CHECK(nights BETWEEN 0 AND 3652058), legacyArrivalDate TEXT, legacyDepartureDate TEXT
  ) STRICT;
  INSERT INTO trip_destinations SELECT s.id, s.tripId, d.city, s.stay, d.notes, s.position, s.arrivalDate, s.departureDate,
    d.miscDailyMinor, d.miscCurrency, d.hotelNightlyMinor, d.hotelCurrency, d.activitiesBudgetMode, d.activitiesGeneralMinor, d.activitiesCurrency,
    d.foodBudgetMode, d.foodDailyMinor, d.foodCurrency, d.shoppingMinor, d.shoppingCurrency,
    d.weatherHighF, d.weatherLowF, d.weatherRainfall, d.weatherPeriod, d.weatherSource, d.churchEnabled, s.nights, s.legacyArrivalDate, s.legacyDepartureDate
    FROM trip_stops s JOIN destinations d ON d.id = s.destinationId;
  CREATE TABLE trip_legs (
    id TEXT PRIMARY KEY, tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    fromId TEXT REFERENCES destinations(id) ON DELETE CASCADE, toId TEXT REFERENCES destinations(id) ON DELETE CASCADE,
    method TEXT NOT NULL DEFAULT '', priceCents INTEGER CHECK(priceCents BETWEEN 0 AND 10000000000),
    departure TEXT NOT NULL DEFAULT '', arrival TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
    itineraryJson TEXT NOT NULL DEFAULT '[]', linksJson TEXT NOT NULL DEFAULT '[]',
    CHECK(fromId IS NOT NULL OR toId IS NOT NULL), CHECK(fromId IS NULL OR toId IS NULL OR fromId != toId)
  ) STRICT;
  INSERT INTO trip_legs SELECT id, tripId, fromId, toId, method, priceCents, departure, arrival, url, notes, itineraryJson, linksJson FROM legs;
  DROP TABLE legs; ALTER TABLE trip_legs RENAME TO legs;
  CREATE UNIQUE INDEX legs_route ON legs(tripId, ifnull(fromId, ''), ifnull(toId, ''));
  DROP TABLE trip_stops; DROP TABLE destinations; ALTER TABLE trip_destinations RENAME TO destinations;
  CREATE INDEX destinations_trip ON destinations(tripId, position);
  PRAGMA user_version = 20;
  PRAGMA foreign_keys = ON;`;

/**
 * A store as its designated owner uses it, for tests about planning rather than access: every read and
 * change is made as that account, as Travel's pages and Server Action make them for the signed-in account.
 */
export function createOwnedStore(path) {
  const store = createStore(path, OWNER_EMAIL);
  const owner = store.authorizeAccount(OWNER_EMAIL).id;
  return {
    ...store,
    applyMutation: (input) => store.applyMutation(owner, input),
    getHomeOverview: () => store.getHomeOverview(owner),
    getTripSnapshot: (tripId, stopId) => store.getTripSnapshot(owner, tripId, stopId),
    getDestinationsOverview: () => store.getDestinationsOverview(owner),
    getDestinationSnapshot: (destinationId) => store.getDestinationSnapshot(owner, destinationId),
    getDestinationImage: (id) => store.getDestinationImage(owner, id),
    getDestinationPhoto: (destinationId, imageId) => store.getDestinationPhoto(owner, destinationId, imageId),
    getCandidatePhoto: (candidateId, imageId) => store.getCandidatePhoto(owner, candidateId, imageId),
    getChurchPhoto: (churchId, imageId) => store.getChurchPhoto(owner, churchId, imageId),
  };
}
