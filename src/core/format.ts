import type {
  BillingCadence,
  CurrencyCode,
  Deposit,
  LinePricing,
  LineSize,
  Listing,
  Price,
  PricingBasis,
  PricingRate,
  PricingTier,
  PricingUnit,
  PaymentTiming,
  QuoteLine,
  ShippingOption,
} from "./types";

/*
 * Display helpers. Everything here *formats* what the server sent. Nothing
 * here prices anything: every amount a shopper sees for a line, a cart or an
 * order comes from POST /quote (or the order), and no function in this SDK
 * multiplies a rate, adds lines up or works out a deposit, tax or total.
 */

export interface FormatOptions {
  /** BCP 47 locale. Defaults to "en-US" so server and browser render alike. */
  locale?: string;
}

const DEFAULT_LOCALE = "en-US";
const moneyFormats = new Map<string, Intl.NumberFormat>();

function moneyFormat(currency: string, locale: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  let nf = moneyFormats.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, { style: "currency", currency });
    moneyFormats.set(key, nf);
  }
  return nf;
}

/**
 * "$25.00" from an amount in the currency's minor units (cents), as every
 * `…Cents` field of the API is. The placeholder "—" when there is no amount.
 * The minor-unit exponent is the currency's own (2 for USD, CAD and GBP).
 */
export function formatMoney(
  cents: number | null | undefined,
  currency: CurrencyCode | string = "USD",
  { locale = DEFAULT_LOCALE }: FormatOptions = {}
): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  const nf = moneyFormat((currency || "USD").toUpperCase(), locale);
  const digits = nf.resolvedOptions().maximumFractionDigits ?? 2;
  // Moving the decimal point for display, not arithmetic on a price.
  return nf.format(cents / 10 ** digits);
}

// ─── Sizes and rates ─────────────────────────────────────────────────────────

export const LENGTH_UNITS: PricingUnit[] = ["in", "ft", "yd", "mm", "cm", "m"];
export const WEIGHT_UNITS: PricingUnit[] = ["oz", "lb", "ton", "g", "kg", "t"];

/** The units a basis is measured in: length units, or weight units. */
export function unitsForBasis(basis?: PricingBasis): PricingUnit[] {
  if (!basis || basis === "quantity") return [];
  return basis === "weight" ? WEIGHT_UNITS : LENGTH_UNITS;
}

/** The unit a size starts in for a basis. */
export function defaultUnitForBasis(
  basis?: PricingBasis
): PricingUnit | undefined {
  if (!basis || basis === "quantity") return undefined;
  return basis === "weight" ? "lb" : "ft";
}

/** True when a price is charged by a measure, so a line needs a size. */
export const isBySize = (rate?: PricingRate | null): boolean =>
  !!rate && rate.basis !== "quantity";

/** "sq ft", "cu yd", "ft", "lb"; empty for a count. */
export function measureUnitLabel(
  basis?: PricingBasis,
  unit?: PricingUnit
): string {
  if (!unit || !basis || basis === "quantity") return "";
  if (basis === "area") return `sq ${unit}`;
  if (basis === "volume") return `cu ${unit}`;
  return unit;
}

const num = (n: number, locale = DEFAULT_LOCALE) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(n);

export const sortedTiers = (rate?: PricingRate | null): PricingTier[] =>
  [...(rate?.tiers ?? [])].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

/** "$9.00 / sq ft", "$0.05 / 10 ea", "$12.00 each". */
export function formatTier(
  tier: PricingTier,
  rate: Pick<PricingRate, "basis" | "unit">,
  currency: CurrencyCode | string = "USD",
  options: FormatOptions = {}
): string {
  const amount = formatMoney(tier.unitAmountCents ?? 0, currency, options);
  const per =
    tier.perUnits && tier.perUnits !== 1
      ? `${num(tier.perUnits, options.locale)} `
      : "";
  const unit = measureUnitLabel(rate.basis, rate.unit);
  if (!unit) return per ? `${amount} / ${per}ea` : `${amount} each`;
  return `${amount} / ${per}${unit}`;
}

/** The rate as one line: its first tier, with "from" when there are more. */
export function formatRate(
  rate: PricingRate,
  currency: CurrencyCode | string = "USD",
  options: FormatOptions = {}
): string {
  const tiers = sortedTiers(rate);
  if (tiers.length === 0) return "";
  const first = formatTier(tiers[0]!, rate, currency, options);
  const head = tiers.length > 1 ? `from ${first}` : first;
  return rate.minimumCents
    ? `${head}, ${formatMoney(rate.minimumCents, currency, options)} minimum`
    : head;
}

/** What a tier's `start` counts, for a tier table's "from" column. */
export function tierStartLabel(rate: PricingRate): string {
  if (rate.tierBy === "quantity" || rate.basis === "quantity") return "qty";
  return measureUnitLabel(rate.basis, rate.unit);
}

/** "4 × 8 ft", "3 cu yd", "120 sq ft", "2 ton". */
export function formatSize(
  size?: LineSize | null,
  options: FormatOptions = {}
): string {
  if (!size) return "";
  const n = (v: number) => num(v, options.locale);
  if (size.amount != null) {
    if (WEIGHT_UNITS.includes(size.unit))
      return `${n(size.amount)} ${size.unit}`;
    return `${n(size.amount)} ${measureUnitLabel(size.basis, size.unit) || size.unit}`;
  }
  const dims = [size.length, size.width, size.height, size.depth].filter(
    (d): d is number => d != null
  );
  if (dims.length === 0) return "";
  return `${dims.map(n).join(" × ")} ${size.unit}`;
}

/**
 * "96 sq ft at $7.50", from a quote line's `pricing`: the tier the server
 * says the line reached. "Minimum charge" when the rate's minimum set it.
 */
export function formatLinePricing(
  pricing?: LinePricing | null,
  currency: CurrencyCode | string = "USD",
  options: FormatOptions = {}
): string {
  if (!pricing) return "";
  if (pricing.minimumApplied) return "Minimum charge";
  const unit = measureUnitLabel(pricing.basis, pricing.unit);
  const units = pricing.units != null ? num(pricing.units, options.locale) : "";
  const tier = pricing.tier;
  const at = tier
    ? `${formatMoney(tier.unitAmountCents ?? 0, currency, options)}${
        tier.perUnits && tier.perUnits !== 1
          ? ` / ${num(tier.perUnits, options.locale)}${unit ? ` ${unit}` : ""}`
          : ""
      }`
    : "";
  const what = unit ? `${units} ${unit}` : units ? `${units} ea` : "";
  return [what, at].filter(Boolean).join(" at ");
}

// ─── Prices ──────────────────────────────────────────────────────────────────

const CADENCE_LABELS: Record<BillingCadence, string> = {
  weekly: "weekly",
  biweekly: "every 2 weeks",
  monthly: "monthly",
  quarterly: "quarterly",
  annually: "annually",
};

/** "monthly", "every 2 weeks"; "one-time" for none. */
export const cadenceLabel = (cadence?: BillingCadence | null): string =>
  cadence ? (CADENCE_LABELS[cadence] ?? cadence) : "one-time";

/**
 * What a price says it costs: its amount, or for a price with a rate the
 * rate itself ("$9.00 / sq ft", "from $12.00 each, $45.00 minimum"). A
 * rate's `unitAmountCents` is only its first tier's and is never shown alone.
 */
export function priceText(
  price: Pick<Price, "rate" | "unitAmountCents" | "currency">,
  options: FormatOptions = {}
): string {
  const currency = price.currency ?? "USD";
  if (price.rate) return formatRate(price.rate, currency, options);
  return formatMoney(price.unitAmountCents, currency, options);
}

type CardPricing = Pick<
  Listing,
  "fromPriceCents" | "dueNowFromCents" | "currency" | "paymentTiming"
>;

/** Part of the "from" price today: more than nothing and less than it (a comparison). */
const partTodayCents = (listing: CardPricing): number | undefined => {
  const today = listing.dueNowFromCents;
  const from = listing.fromPriceCents;
  return today != null && from != null && today > 0 && today < from
    ? today
    : undefined;
};

/**
 * A grid card's price: "From $40", and "From $40 · $20 today" when checkout
 * takes part of it today. Both figures are the server's (`fromPriceCents`,
 * `dueNowFromCents`).
 */
export function cardPriceText(
  listing: CardPricing,
  options: FormatOptions = {}
): string | undefined {
  if (listing.fromPriceCents == null) return undefined;
  const money = (c: number) => formatMoney(c, listing.currency, options);
  const from = `From ${money(listing.fromPriceCents)}`;
  const today = partTodayCents(listing);
  return today != null ? `${from} · ${money(today)} today` : from;
}

/** The card's short note: "Invoiced when ready", "Deposit today", or nothing. */
export function cardTermsText(listing: CardPricing): string | undefined {
  if (listing.dueNowFromCents != null) {
    if (listing.dueNowFromCents === 0) return "Invoiced when ready";
    return partTodayCents(listing) != null ? "Deposit today" : undefined;
  }
  switch (listing.paymentTiming) {
    case "invoice_later":
      return "Invoiced when ready";
    case "deposit_at_checkout":
      return "Deposit today";
    default:
      return undefined;
  }
}

export interface PaymentTerms {
  paymentTiming?: PaymentTiming;
  deposit?: Deposit;
}

const percentText = (bps: number, locale = DEFAULT_LOCALE) =>
  new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(bps / 10000);

/**
 * "Pay a $50.00 deposit per item today, the rest invoiced later",
 * "Invoiced when ready: nothing to pay today", or nothing for an item paid in
 * full. The deposit is worded exactly as the listing serves it; what it
 * comes to for a cart is the quote's to say (`quotedTermsText`).
 */
export function paymentTermsText(
  terms: PaymentTerms,
  currency?: CurrencyCode | string,
  options: FormatOptions = {}
): string | undefined {
  switch (terms.paymentTiming) {
    case "invoice_later":
      return "Invoiced when ready: nothing to pay today";
    case "deposit_at_checkout": {
      const { deposit } = terms;
      if (deposit?.kind === "amount" && deposit.amountCents != null)
        return `Pay a ${formatMoney(deposit.amountCents, currency, options)} deposit per item today, the rest invoiced later`;
      if (deposit?.kind === "percent" && deposit.percentBps != null)
        return `Pay a ${percentText(deposit.percentBps, options.locale)} deposit today, the rest invoiced later`;
      return "Pay a deposit today, the rest invoiced later";
    }
    default:
      return undefined;
  }
}

/** "Refundable if the order is canceled." for a listing's deposit. */
export function depositRefundText(terms: PaymentTerms): string | undefined {
  if (terms.paymentTiming !== "deposit_at_checkout" || !terms.deposit)
    return undefined;
  return terms.deposit.refundable
    ? "Refundable if the order is canceled."
    : "The deposit isn't refundable.";
}

type QuotedTerms = Pick<
  QuoteLine,
  "paymentTiming" | "dueNowCents" | "amountCents" | "depositRefundable"
>;

/** "Deposit today: $100.00 of $400.00" — both figures the quote line's. */
export function quotedTermsText(
  line: QuotedTerms,
  currency?: CurrencyCode | string,
  options: FormatOptions = {}
): string | undefined {
  switch (line.paymentTiming) {
    case "invoice_later":
      return "Invoiced when ready: nothing to pay today";
    case "deposit_at_checkout":
      return line.dueNowCents != null && line.amountCents != null
        ? `Deposit today: ${formatMoney(line.dueNowCents, currency, options)} of ${formatMoney(line.amountCents, currency, options)}`
        : undefined;
    default:
      return undefined;
  }
}

/** The refund wording for a quoted deposit line, from `depositRefundable`. */
export function quotedRefundText(line: QuotedTerms): string | undefined {
  if (
    line.paymentTiming !== "deposit_at_checkout" ||
    line.depositRefundable == null
  )
    return undefined;
  return line.depositRefundable
    ? "Refundable if the order is canceled."
    : "The deposit isn't refundable.";
}

/** "Free", or the charge and "free over $X" — both the server's figures. */
export function shippingChargeText(
  option: Pick<ShippingOption, "chargeCents" | "freeOverCents">,
  currency?: CurrencyCode | string,
  options: FormatOptions = {}
): string {
  if (!option.chargeCents) return "Free";
  const money = (c: number) => formatMoney(c, currency, options);
  return option.freeOverCents != null
    ? `${money(option.chargeCents)} · free over ${money(option.freeOverCents)}`
    : money(option.chargeCents);
}

/** Methods that bring the order to an address; a pickup takes none. */
export const isDelivered = (
  option?: Pick<ShippingOption, "kind"> | null
): boolean => option?.kind === "local_delivery" || option?.kind === "flat_rate";
