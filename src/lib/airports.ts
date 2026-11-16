import data from "./airports.json" with { type: "json" };

/**
 * An airport Travel finds by its IATA code (TRA-132): its name, the city it serves, its country's ISO code and where it
 * is. They come from OurAirports' public-domain data, saved in `airports.json` by `scripts/update-airports.mjs`.
 */
export interface Airport { code: string; name: string; city: string; countryCode: string; latitude: number; longitude: number }

type AirportRow = [code: string, name: string, city: string, countryCode: string, latitude: number, longitude: number];

const airports = new Map((data as AirportRow[]).map(([code, name, city, countryCode, latitude, longitude]) =>
  [code, { code, name, city, countryCode, latitude, longitude }]));

/** The airport with this IATA code, written in capitals, such as "CLE". ICAO codes and city codes such as "NYC" name none. */
export function airportByCode(code: string): Airport | undefined {
  return airports.get(code);
}

/** An airport's name with its code, as Travel shows it: "Cleveland Hopkins International Airport (CLE)". */
export function airportName(airport: Airport): string {
  return `${airport.name} (${airport.code})`;
}
