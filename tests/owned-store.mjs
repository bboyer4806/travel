import { createStore } from "../src/lib/store.ts";

/** The designated owner that planning tests work as. Ownership, sharing and isolation are tested in sharing.test.mjs. */
export const OWNER_EMAIL = "owner@example.test";

/** Turns a schema 20 database back into schema 19, as before trip ownership and sharing, to test the upgrade. */
export const UNDO_SCHEMA_20 = `
  DROP TRIGGER trips_insert_owner; DROP TRIGGER trips_update_owner; DROP INDEX trips_owner;
  DROP TABLE trip_shares; ALTER TABLE trips DROP COLUMN ownerId; PRAGMA user_version = 19;`;

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
    getDestinationImage: (id) => store.getDestinationImage(owner, id),
    getDestinationPhoto: (destinationId, imageId) => store.getDestinationPhoto(owner, destinationId, imageId),
    getCandidatePhoto: (candidateId, imageId) => store.getCandidatePhoto(owner, candidateId, imageId),
    getChurchPhoto: (churchId, imageId) => store.getChurchPhoto(owner, churchId, imageId),
  };
}
