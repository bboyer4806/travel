import { writeFileSync } from "node:fs";

// Refreshes src/lib/airports.json, the airports Travel finds by their IATA codes (TRA-132), from OurAirports'
// public-domain data: https://ourairports.com/data/. Run `node scripts/update-airports.mjs` and review the diff.
const SOURCE = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const OUTPUT = new URL("../src/lib/airports.json", import.meta.url);

/** The rows of a CSV file as objects keyed by its header, with quoted fields that may hold commas, quotes and line breaks. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (quoted) throw new Error("The airport data ends inside a quoted field.");
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...records] = rows;
  return records.map((record) => {
    if (record.length !== header.length) throw new Error(`An airport row has ${record.length} fields, not ${header.length}.`);
    return Object.fromEntries(header.map((name, index) => [name, record[index]]));
  });
}

const clean = (value) => value.trim().replace(/\s+/g, " ");

/** A coordinate within `limit` degrees, rounded to 4 decimal places, about 11 meters. */
function coordinate(value, limit, code) {
  const number = Number(value);
  if (value.trim() === "" || !Number.isFinite(number) || Math.abs(number) > limit) throw new Error(`${code} has an invalid coordinate: ${value}`);
  return Math.round(number * 10_000) / 10_000;
}

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`OurAirports answered ${response.status}.`);
const airports = new Map();
for (const row of parseCsv(await response.text())) {
  // A closed airport's code no longer names it.
  if (!row.iata_code || row.type === "closed") continue;
  const code = row.iata_code;
  if (!/^[A-Z]{3}$/.test(code)) throw new Error(`An airport has an invalid IATA code: ${code}`);
  if (airports.has(code)) throw new Error(`Two airports have the IATA code ${code}.`);
  const name = clean(row.name);
  if (!name) throw new Error(`${code} has no name.`);
  if (!/^[A-Z]{2}$/.test(row.iso_country)) throw new Error(`${code} has an invalid country code: ${row.iso_country}`);
  airports.set(code, [code, name, clean(row.municipality), row.iso_country, coordinate(row.latitude_deg, 90, code), coordinate(row.longitude_deg, 180, code)]);
}
if (airports.size < 5000) throw new Error(`Only ${airports.size} airports have IATA codes; the data looks incomplete.`);

// One airport a line, in code order, so a refresh's diff shows each change.
const lines = [...airports.keys()].sort().map((code) => JSON.stringify(airports.get(code)));
writeFileSync(OUTPUT, "[\n" + lines.join(",\n") + "\n]\n");
console.log(`Saved ${airports.size} airports to src/lib/airports.json.`);
