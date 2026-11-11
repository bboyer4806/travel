export const SUPPORTED_CURRENCIES: string[] = ["USD"];
const supportedCurrencies = new Set(SUPPORTED_CURRENCIES);
/** The largest amount anyone can enter, in dollars. Amount inputs offer it as their maximum. */
export const MAX_AMOUNT_DOLLARS = 100_000_000;
/** The same limit in cents, the unit amounts are saved in. Saved prices' database constraints enforce it. */
export const MAX_AMOUNT_CENTS = MAX_AMOUNT_DOLLARS * 100;

export function currencyDigits(currency: string): number {
  if (!supportedCurrencies.has(currency)) throw new Error("All amounts must be entered in USD.");
  // Currency formatting without significant-digit options always resolves fraction digits.
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits!;
}

/**
 * An entered amount in minor units, or null when blank. Every amount, from prices to daily budgets,
 * follows these rules and messages; `label` names the field in them.
 */
export function parseMinorAmount(value: string, currency: string | null, label: string): number | null {
  const amount = value.trim();
  if (!amount) return null;
  const code = currency || "USD";
  const digits = currencyDigits(code);
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^(?:\\d+|\\d*\\.\\d{1,${digits}})$`);
  if (!pattern.test(amount)) throw new Error(`${label} must be a positive ${code} amount or zero, with up to ${digits} decimal places. Leave it blank if unknown.`);
  const [major, fraction = ""] = amount.split(".");
  const minor = Number(major || "0") * 10 ** digits + Number(fraction.padEnd(digits, "0"));
  const max = MAX_AMOUNT_DOLLARS * 10 ** digits;
  if (!Number.isSafeInteger(minor) || minor > max) throw new Error(`${label} must be ${formatCurrency(max, code)} or less.`);
  return minor;
}

export function formatCurrency(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: minor % 100 === 0 ? 0 : 2, maximumFractionDigits: digits }).format(minor / 10 ** digits);
}

export function minorAmountValue(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor == null || !currency) return "";
  return (minor / 10 ** currencyDigits(currency)).toFixed(currencyDigits(currency));
}
