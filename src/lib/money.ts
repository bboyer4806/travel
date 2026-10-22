export const SUPPORTED_CURRENCIES: string[] = Intl.supportedValuesOf("currency");
const supportedCurrencies = new Set(SUPPORTED_CURRENCIES);
const MAX_MAJOR_AMOUNT = 100_000_000;

export function currencyDigits(currency: string): number {
  if (!supportedCurrencies.has(currency)) throw new Error("Choose a supported currency.");
  // Currency formatting without significant-digit options always resolves fraction digits.
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits!;
}

export function parseMinorAmount(value: string, currency: string | null): number | null {
  const amount = value.trim();
  if (!amount) return null;
  if (!currency) throw new Error("Choose a currency for the daily miscellaneous amount.");
  const digits = currencyDigits(currency);
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^(?:\\d+|\\d*\\.\\d{1,${digits}})$`);
  if (!pattern.test(amount)) throw new Error(`Daily miscellaneous amount must be positive or zero, with up to ${digits} decimal places for ${currency}. Leave it blank if unknown.`);
  const [major, fraction = ""] = amount.split(".");
  const minor = Number(major || "0") * 10 ** digits + Number(fraction.padEnd(digits, "0"));
  if (!Number.isSafeInteger(minor) || minor > MAX_MAJOR_AMOUNT * 10 ** digits) throw new Error("Daily miscellaneous amount must be 100,000,000 or less.");
  return minor;
}

export function formatCurrency(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code", minimumFractionDigits: 0, maximumFractionDigits: digits }).format(minor / 10 ** digits);
}

export function minorAmountValue(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor == null || !currency) return "";
  return (minor / 10 ** currencyDigits(currency)).toFixed(currencyDigits(currency));
}
