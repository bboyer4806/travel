import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import sharp from "sharp";
import { prepareCandidateGallery } from "../src/lib/candidate-gallery-upload.ts";
import { galleryForm } from "../src/lib/gallery-draft.ts";
import { IMAGE_URL_DOWNLOAD_SECONDS, MAX_IMAGE_UPLOAD_BYTES } from "../src/lib/image-limits.ts";
import { ImageValidationError } from "../src/lib/image-upload.ts";
import { downloadImageByUrl, imageUrlResponse, MAX_IMAGE_URL_LENGTH } from "../src/lib/image-url.ts";
import { addDestination, candidateInput, setup } from "./budget-fixtures.mjs";

// TRA-139: Add image by URL downloads the image at a web address for a photo editor, which previews it before adding it.
const refusal = (message) => (error) => error instanceof ImageValidationError && message.test(error.message);
const image = (format, color, width = 40, height = 30) => sharp({ create: { width, height, channels: 3, background: color } })[format]().toBuffer();
/** A fetch serving each address's response: `[type, bytes]`, or a function of the request's signal. Others aren't found. */
function serve(routes) {
  const requested = [];
  const fetch = async (url, signal) => {
    requested.push(url.href);
    const route = routes[url.href];
    if (typeof route === "function") return route(signal);
    if (!route) return Object.assign(Readable.from([]), { statusCode: 404, headers: {} });
    return Object.assign(Readable.from([route[1]]), { statusCode: 200, headers: { "content-type": route[0] } });
  };
  return { fetch, requested };
}

test("an image added by URL downloads over HTTP or HTTPS and comes back as its server sent it, once it is checked as an upload is", async () => {
  const jpeg = await image("jpeg", "#285f56", 2400, 1600);
  const png = await image("png", "#c46b2d");
  const { fetch, requested } = serve({
    "https://images.example.com/a.jpg": ["image/jpeg", jpeg],
    "http://images.example.com/b.png": ["image/png", png],
    "https://images.example.com/moved": () => Object.assign(Readable.from([]), { statusCode: 302, headers: { location: "http://images.example.com/b.png" } }),
  });
  const first = await downloadImageByUrl("https://images.example.com/a.jpg", fetch);
  assert.deepEqual([first.type, Buffer.from(await first.arrayBuffer()).equals(jpeg)], ["image/jpeg", true], "the photo itself, for saving to prepare as an upload");
  const second = await downloadImageByUrl("http://images.example.com/b.png", fetch);
  assert.deepEqual([second.type, Buffer.from(await second.arrayBuffer()).equals(png)], ["image/png", true]);
  const moved = await downloadImageByUrl("https://images.example.com/moved", fetch);
  assert.equal(moved.type, "image/png", "a redirect is followed, to an http:// address too");
  assert.deepEqual(requested, ["https://images.example.com/a.jpg", "http://images.example.com/b.png", "https://images.example.com/moved", "http://images.example.com/b.png"]);
  assert.equal(IMAGE_URL_DOWNLOAD_SECONDS, 15);
});

test("an image added by URL is refused, with why, when Travel can't download it or an upload of it would be refused", async () => {
  const png = await image("png", "#3b4f8a");
  // Addresses are checked before anything is requested.
  for (const [address, message] of [
    ["images.example.com/a.jpg", /^This isn't a web address\. Give the photo's http:\/\/ or https:\/\/ address\.$/],
    ["ftp://images.example.com/a.jpg", /^Travel downloads photos only from http:\/\/ or https:\/\/ addresses\.$/],
    ["http://192.168.1.20/camera.jpg", /^Travel doesn't download photos from private, loopback or link-local addresses\.$/],
    ["http://169.254.169.254/latest/meta-data/", /^Travel doesn't download photos from private, loopback or link-local addresses\.$/],
  ]) {
    const { fetch, requested } = serve({});
    await assert.rejects(downloadImageByUrl(address, fetch), refusal(message), address);
    assert.deepEqual(requested, [], `${address} requested nothing`);
  }
  // What the server answers, and what an upload of the image would be refused for.
  for (const [route, message] of [
    [undefined, /^The photo's server answered 404 Not Found\.$/],
    [["text/html", Buffer.from("<html>")], /^This address isn't a JPEG, PNG or WebP image: its server says it is text\/html\.$/],
    [["image/gif", Buffer.from("GIF89a")], /its server says it is image\/gif\.$/],
    [["image/png", Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1)], /^This photo is larger than 5 MB\.$/],
    [() => Object.assign(Readable.from([]), { statusCode: 307, headers: { location: "http://10.0.0.8/a.png" } }), /^Travel doesn't download photos from private/],
    [["image/png", Buffer.from("not a png")], /^We couldn't read that image\. Choose a JPEG, PNG, or WebP image up to 20 megapixels\.$/],
    [["image/png", Buffer.alloc(0)], /^That image is empty\. Choose another image\.$/],
  ]) {
    await assert.rejects(downloadImageByUrl("https://images.example.com/photo", serve({ "https://images.example.com/photo": route }).fetch), refusal(message), String(message));
  }
  // A photo that never finishes downloading stops at the time limit, which the refusal states.
  let stopped = false;
  const stalled = serve({ "https://images.example.com/slow.png": () => Object.assign(new Readable({ read() {}, destroy(error, done) { stopped = true; done(error); } }), { statusCode: 200, headers: { "content-type": "image/png" } }) });
  await assert.rejects(downloadImageByUrl("https://images.example.com/slow.png", stalled.fetch, 100), refusal(/^The photo didn't download within 0\.1 seconds\.$/));
  assert.equal(stopped, true, "the download stopped");
  assert.equal((await downloadImageByUrl("https://images.example.com/ok.png", serve({ "https://images.example.com/ok.png": ["image/png", png] }).fetch)).size, png.byteLength);
});

/** A request from Travel's page, as the photo editors send it, with `headers` changing it and `body` as sent. */
function request(body, headers = {}) {
  return new Request("http://0.0.0.0:3000/api/image-url", {
    method: "POST",
    headers: { host: "travel.example", origin: "https://travel.example", "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
/** A stand-in download, recording each address it is given. */
function downloads(result) {
  const addresses = [];
  return { addresses, download: async (address) => { addresses.push(address); return result(address); } };
}

test("Add image by URL's route answers with the image's bytes and type, never cached, for a request from Travel's page", async () => {
  const png = await image("png", "#c46b2d");
  const { addresses, download } = downloads(() => new File([png], "photo", { type: "image/png" }));
  const response = await imageUrlResponse(request({ url: "  https://images.example.com/b.png \n" }), download);
  assert.deepEqual([response.status, response.headers.get("content-type"), response.headers.get("cache-control"), response.headers.get("x-content-type-options")], [200, "image/png", "no-store", "nosniff"]);
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(png));
  assert.deepEqual(addresses, ["https://images.example.com/b.png"], "the address is downloaded without the spaces around it");
});

test("Add image by URL's route refuses other sites, malformed requests and images Travel can't use, saying why", async () => {
  const { addresses, download } = downloads((address) => {
    if (address.endsWith("/missing.jpg")) throw new ImageValidationError("The photo's server answered 404 Not Found.");
    throw new Error("unexpected");
  });
  const refused = async (response, status, error) => {
    assert.deepEqual([response.status, response.headers.get("cache-control"), await response.json()], [status, "no-store", { error }]);
  };
  await refused(await imageUrlResponse(request({ url: "https://images.example.com/a.jpg" }, { origin: "https://elsewhere.example" }), download), 403, "Refresh the page and try again.");
  await refused(await imageUrlResponse(request({ url: "https://images.example.com/a.jpg" }, { "sec-fetch-site": "same-site" }), download), 403, "Refresh the page and try again.");
  await refused(await imageUrlResponse(request("not json"), download), 400, "Enter the image's web address and try again.");
  await refused(await imageUrlResponse(request("null"), download), 400, "Enter the image's web address and try again.");
  for (const body of [{}, { url: 42 }, { url: "   " }, ["https://images.example.com/a.jpg"]]) await refused(await imageUrlResponse(request(body), download), 400, "Enter the image's web address.");
  const long = `https://images.example.com/${"a".repeat(MAX_IMAGE_URL_LENGTH)}.jpg`;
  await refused(await imageUrlResponse(request({ url: long }), download), 400, "Enter a web address of up to 4,096 characters.");
  assert.deepEqual(addresses, [], "nothing is downloaded for a refused request");
  await refused(await imageUrlResponse(request({ url: "https://images.example.com/missing.jpg" }), download), 422, "The photo's server answered 404 Not Found.");
  // Anything else is a fault for the route to report, never a message to show.
  await assert.rejects(imageUrlResponse(request({ url: "https://images.example.com/fault.jpg" }), download), /unexpected/);
});

test("Add image by URL's route downloads through Travel's own checks unless a test stands in for them", async () => {
  // Its default download is downloadImageByUrl, which refuses a private address before connecting anywhere.
  const response = await imageUrlResponse(request({ url: "http://127.0.0.1:9/a.png" }));
  assert.deepEqual([response.status, await response.json()], [422, { error: "Travel doesn't download photos from private, loopback or link-local addresses." }]);
});

test("an image added by URL is saved as Travel's own copy beside uploaded photos, and stays after its source is gone", async (t) => {
  const { store, tripId } = setup(t);
  const destinationId = addDestination(store, tripId);
  const hotelId = store.applyMutation(candidateInput(destinationId, "hotels", { name: "Hotel Sacher" })).id;
  const address = "https://images.example.com/sacher.jpg";
  const routes = { [address]: ["image/jpeg", await image("jpeg", "#285f56", 2400, 1600)] };
  const { fetch } = serve(routes);
  const downloaded = await downloadImageByUrl(address, fetch);
  // The editor's draft once a photo is chosen from the device and another added by URL, the second chosen as the main photo.
  const uploaded = { id: randomUUID(), file: new File([await image("png", "#c46b2d")], "lobby.png", { type: "image/png" }) };
  const byUrl = { id: randomUUID(), file: new File([downloaded], "sacher.jpg", { type: downloaded.type }) };
  const gallery = await prepareCandidateGallery(galleryForm({ images: [uploaded, byUrl], removedIds: [], mainImageId: byUrl.id }));
  store.applyMutation({ ...candidateInput(destinationId, "hotels", { id: hotelId, name: "Hotel Sacher" }), gallery });
  delete routes[address];
  await assert.rejects(downloadImageByUrl(address, fetch), refusal(/^The photo's server answered 404 Not Found\.$/), "its source is gone");
  const hotel = store.getSnapshot().candidates.find((candidate) => candidate.id === hotelId);
  assert.deepEqual([hotel.images.map((photo) => photo.id), hotel.mainImageId], [[uploaded.id, byUrl.id], byUrl.id]);
  const saved = await sharp(store.getCandidatePhoto(hotelId, byUrl.id).data).metadata();
  assert.deepEqual([saved.format, saved.width, saved.height], ["webp", 1600, 1067], "Travel keeps the copy it prepared, as it does an upload's");
  assert.equal((await sharp(store.getCandidatePhoto(hotelId, uploaded.id).data).metadata()).format, "webp", "the uploaded photo is saved beside it");
});
