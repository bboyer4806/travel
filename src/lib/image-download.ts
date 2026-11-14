import { lookup as dnsLookup } from "node:dns";
import { STATUS_CODES, type IncomingHttpHeaders } from "node:http";
import { request } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import type { Readable } from "node:stream";

import { formatMegabytes, IMAGE_UPLOAD_TYPES, MAX_IMAGE_UPLOAD_BYTES } from "./image-limits.ts";
import { ImageValidationError } from "./image-upload.ts";

/**
 * Downloads the photos ChatGPT and Claude propose from the addresses they give (TRA-122): HTTPS only, from public
 * internet addresses only, checked for the address given, for every redirect, and again for the addresses a host name
 * resolves to as Travel connects, so a name can't point Travel at its own network. A download holds no more than an
 * upload may, and what it holds is checked by prepareImage as an upload is.
 */

/** Redirects a download follows from the address it is given. */
export const MAX_IMAGE_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const PRIVATE = "Travel doesn't download photos from private, loopback or link-local addresses.";

/** IPv4 addresses off the public internet: this network, private, shared, loopback, link-local, protocol, documentation, benchmarking, 6to4 relay, multicast and reserved ranges. */
const PRIVATE_IPV4 = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) {
  PRIVATE_IPV4.addSubnet(network, prefix, "ipv4");
}
/** Global unicast IPv6. Everything else, loopback, link-local, unique local, multicast and IPv4-mapped included, isn't public. */
const GLOBAL_IPV6 = new BlockList();
GLOBAL_IPV6.addSubnet("2000::", 3, "ipv6");
/** Global unicast ranges that aren't public hosts: IETF protocol assignments (Teredo among them), documentation, and 6to4, which stands for IPv4 addresses. */
const SPECIAL_IPV6 = new BlockList();
for (const [network, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) SPECIAL_IPV6.addSubnet(network, prefix, "ipv6");

/** Whether an IP address is a public internet host's. */
export function isPublicAddress(address: string): boolean {
  switch (isIP(address)) {
    case 4: return !PRIVATE_IPV4.check(address, "ipv4");
    case 6: return GLOBAL_IPV6.check(address, "ipv6") && !SPECIAL_IPV6.check(address, "ipv6");
    default: return false;
  }
}

/**
 * The address to download a photo from, read relative to `base` for a redirect: https://, without a user name or
 * password, and not an IP address off the public internet. A host name's addresses are checked as Travel connects.
 */
export function downloadAddress(address: string, base?: URL): URL {
  let url: URL;
  try {
    url = new URL(address, base);
  } catch {
    throw new ImageValidationError("This isn't a web address. Give the photo's https:// address.");
  }
  if (url.protocol !== "https:") throw new ImageValidationError("Travel downloads photos only from https:// addresses.");
  if (url.username || url.password) throw new ImageValidationError("Give the photo's address without a user name or password.");
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (isIP(host) && !isPublicAddress(host)) throw new ImageValidationError(PRIVATE);
  return url;
}

/** Looks up a host name as Travel connects to it, refusing a name with any address off the public internet. */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "");
    if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) return callback(new ImageValidationError(PRIVATE), "");
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

/** One response, its body not yet read. */
export type PhotoResponse = Readable & { statusCode?: number; headers: IncomingHttpHeaders };
/** Requests one address, without following a redirect, until `signal` aborts. */
export type PhotoFetch = (url: URL, signal: AbortSignal) => Promise<PhotoResponse>;

/** Travel's own request: straight to a public address, never through a proxy, on a connection of its own. */
export const fetchPublic: PhotoFetch = (url, signal) => new Promise((resolve, reject) => {
  request(url, { agent: false, lookup: publicLookup, signal, headers: { Accept: IMAGE_UPLOAD_TYPES.join(", "), "User-Agent": "TravelPlanner/1.0" } }, resolve)
    .on("error", reject)
    .end();
});

/**
 * Downloads a photo as the file an upload would be, for prepareImage to check. Follows up to MAX_IMAGE_REDIRECTS
 * redirects, each checked as the address given is, and refuses a photo larger than an upload may be or one its server
 * doesn't call a JPEG, PNG or WebP image. When `signal` aborts, it stops and throws the signal's reason.
 */
export async function downloadImage(address: string, signal: AbortSignal, fetch: PhotoFetch = fetchPublic): Promise<File> {
  let url = downloadAddress(address);
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetch(url, signal).catch((error: unknown) => { throw failure(error, signal); });
    // Each response stops when the signal aborts, however it was fetched, and once it is done with.
    const stop = () => response.destroy();
    signal.addEventListener("abort", stop);
    try {
      signal.throwIfAborted();
      const status = response.statusCode ?? 0;
      if (!REDIRECT_STATUSES.has(status)) return await photoFile(response, status);
      const location = response.headers.location;
      if (!location) throw new ImageValidationError(`The photo's server answered ${status} without saying where the photo is.`);
      if (redirects === MAX_IMAGE_REDIRECTS) throw new ImageValidationError(`The photo's address redirects more than ${MAX_IMAGE_REDIRECTS} times.`);
      url = downloadAddress(location, url);
    } catch (error) {
      throw failure(error, signal);
    } finally {
      signal.removeEventListener("abort", stop);
      response.destroy();
    }
  }
}

/** A final response's photo, read up to the upload limit. */
async function photoFile(response: PhotoResponse, status: number): Promise<File> {
  if (status !== 200) throw new ImageValidationError(`The photo's server answered ${status}${STATUS_CODES[status] ? ` ${STATUS_CODES[status]}` : ""}.`);
  const type = (response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (!IMAGE_UPLOAD_TYPES.includes(type)) throw new ImageValidationError(`This address isn't a JPEG, PNG or WebP image${type ? `: its server says it is ${type}` : ""}.`);
  const tooLarge = () => new ImageValidationError(`This photo is larger than ${formatMegabytes(MAX_IMAGE_UPLOAD_BYTES)}.`);
  if (Number(response.headers["content-length"]) > MAX_IMAGE_UPLOAD_BYTES) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response as AsyncIterable<Buffer>) {
    size += chunk.byteLength;
    if (size > MAX_IMAGE_UPLOAD_BYTES) throw tooLarge();
    chunks.push(chunk);
  }
  return new File([Buffer.concat(chunks)], "photo", { type });
}

/** What a failed download throws: the signal's reason once it aborts, a refusal as it is, and why the photo couldn't be reached otherwise. */
function failure(error: unknown, signal: AbortSignal): unknown {
  if (signal.aborted) return signal.reason;
  if (error instanceof ImageValidationError) return error;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return new ImageValidationError(code === "ENOTFOUND" ? "Travel couldn't find this photo's server." : `Travel couldn't download this photo${code ? ` (${code})` : ""}.`);
}
