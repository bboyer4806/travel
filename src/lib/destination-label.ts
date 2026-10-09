const MAX_LABEL_LENGTH = 120;
const COUNTRY_CODES = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW".split(" ");
const countryNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
const countryCodesByName = new Map<string, string>();
for (const code of COUNTRY_CODES) {
  countryCodesByName.set(code.toLowerCase(), code);
  const name = countryNames.of(code);
  if (name) countryCodesByName.set(name.toLowerCase(), code);
}
for (const [name, code] of Object.entries({
  "united states of america": "US", usa: "US", "u.s.": "US", "u.s.a.": "US",
  uk: "GB", "great britain": "GB", "czech republic": "CZ", turkey: "TR",
})) countryCodesByName.set(name, code);

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia", AS: "American Samoa", GU: "Guam",
  MP: "Northern Mariana Islands", PR: "Puerto Rico", VI: "U.S. Virgin Islands", UM: "U.S. Outlying Islands",
};
function clean(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
function recognizedCountry(value: string): string | undefined {
  return countryCodesByName.get(clean(value).toLowerCase());
}

/** Display only: keep the provider's complete location label as the saved identity. */
export function formatDestinationLabel(location: { name: string; region: string; country: string; countryCode?: string }): string {
  const name = clean(location.name);
  const region = clean(location.region);
  const rawCountry = clean(location.country);
  const countryCode = recognizedCountry(location.countryCode ?? "") ?? recognizedCountry(rawCountry);
  const country = rawCountry.length === 2 || !rawCountry
    ? (countryCode ? countryNames.of(countryCode) ?? rawCountry : rawCountry)
    : rawCountry;
  const area = countryCode === "US" && region ? US_STATES[region.toUpperCase()] ?? region : country;
  const includeState = countryCode === "US" && Boolean(region);
  const parts = [name, area].filter((part, index, all) => part && (includeState || all.findIndex((other) => other.toLowerCase() === part.toLowerCase()) === index));
  const label = parts.join(", ");
  // Drop the qualifier instead of clipping any place name. Provider names are already bounded.
  if (label.length <= MAX_LABEL_LENGTH) return label;
  return name.length <= MAX_LABEL_LENGTH ? name : "";
}

/** Shorten only structured legacy labels; preserve all other user-entered text verbatim. */
export function formatSavedDestinationLabel(value: string): string {
  const parts = value.split(",");
  if (parts.length !== 3 || parts.some((part) => !part.trim())) return value;
  const [name, region, country] = parts.map(clean);
  const countryCode = recognizedCountry(country);
  if (!countryCode) return value;
  return formatDestinationLabel({ name, region, country, countryCode });
}
