import {
  answersForCheckout,
  draftFits,
  draftsKey,
  type FieldDrafts,
  isFormField,
} from "./fieldAnswers";
import { isBySize } from "./format";
import {
  DEPOSIT_KINDS,
  PAYMENT_TIMINGS,
  PRICING_BASES,
  PRICING_UNITS,
  type Address,
  type CheckoutLineRequest,
  type CheckoutRequest,
  type CurrencyCode,
  type Deposit,
  type FormField,
  type LineSize,
  type PaymentTiming,
  type Price,
  type PricingRate,
  type QuoteLine,
  type QuoteRequest,
} from "./types";

/*
 * A shopper's cart on a public store, as plain data and pure rules.
 *
 * The server keeps nothing until checkout, so the cart lives in the browser,
 * one per store. What checkout sends is `{listingId, priceId, quantity}` (and
 * `size` for a price by size, and the line's answers as `fields`); the rest of
 * a line is what the cart shows, copied from the listing when it was added.
 * The server prices every line again, so a stale copy can only mislabel the
 * cart, never change what is charged. Nothing here adds money up.
 */

/** The server's caps on a checkout: lines per order and quantity per line. */
export const MAX_CART_LINES = 50;
export const MAX_LINE_QUANTITY = 999;

export interface CartLine {
  listingId: string;
  priceId: string;
  quantity: number;
  /** Shown in the cart only; checkout re-reads everything from the server. */
  name: string;
  /** "Size: 3x6 · Color: Red", or empty for a listing without options. */
  optionLabel: string;
  /**
   * The price's listed amount, for "$12.00 each" beside the line. Display
   * only: what the line comes to is the quote's `lines[i].amountCents`.
   */
  unitAmountCents: number;
  /** Every line of a cart shares one currency. */
  currency: CurrencyCode;
  imageUrl?: string;
  /** The listing option's own id, since a product can be listed twice. */
  optionId?: string;
  /** The form this line answers, kept so the cart can correct the answers. */
  form?: FormField[];
  /** The answers, as typed; turned into checkout's `fields` when sent. */
  answers?: FieldDrafts;
  /** How this line is paid for, as the option said when it was added. */
  paymentTiming?: PaymentTiming;
  deposit?: Deposit;
  /**
   * The price's rate, when it is by size, in tiers or has a minimum: kept to
   * draw the size input and the rate table. Never multiplied here.
   */
  rate?: PricingRate;
  /** One item's size, for a price by length, area, volume or weight. */
  size?: LineSize;
}

export interface Cart {
  lines: CartLine[];
}

export const EMPTY_CART: Cart = Object.freeze({
  lines: Object.freeze([]) as unknown as CartLine[],
});

/** The cart's currency: its first line's, since every line shares it. */
export const cartCurrency = (cart: Cart): CurrencyCode | undefined =>
  cart.lines[0]?.currency;

/** How many items are in the cart (a count, for a badge). */
export const cartItemCount = (cart: Cart): number =>
  cart.lines.reduce((sum, line) => sum + line.quantity, 0);

/** A price by size whose line has no size yet: nothing can price it. */
export const lineNeedsSize = (line: Pick<CartLine, "rate" | "size">) =>
  isBySize(line.rate) && !line.size;

/** How a refusal names a line: "Banner (Size: 3x6)". */
export const cartLineName = (l: Pick<CartLine, "name" | "optionLabel">) =>
  l.optionLabel ? `${l.name} (${l.optionLabel})` : l.name;

/** A size as one comparable string; empty for none. */
export const sizeKey = (size?: LineSize): string =>
  size
    ? [
        size.unit,
        size.basis,
        size.amount,
        size.length,
        size.width,
        size.height,
        size.depth,
      ]
        .map((v) => (v == null ? "" : String(v)))
        .join("|")
    : "";

/** A price a shopper can buy at checkout: a one-time price, no cadence. */
export const isBuyablePrice = (price: Price): boolean =>
  !price.cadence && Boolean(price.id);

/**
 * The price an option sells at in the cart: a one-time price, in the cart's
 * currency when the option has one in it. Undefined when every price is a
 * subscription, which checkout refuses.
 */
export function buyablePrice(
  prices: Price[] | undefined,
  currency?: CurrencyCode
): Price | undefined {
  const buyable = (prices ?? []).filter(isBuyablePrice);
  if (currency) {
    const same = buyable.find((p) => p.currency === currency);
    if (same) return same;
  }
  return buyable[0];
}

/** "Size: 3x6 · Color: Red", in the listing's option-name order. */
export function optionLabel(
  optionNames: string[],
  options: Record<string, string> | undefined
): string {
  return optionNames
    .filter((name) => options?.[name])
    .map((name) => `${name}: ${options?.[name]}`)
    .join(" · ");
}

export type CartRefusal =
  | { reason: "currency"; cartCurrency: CurrencyCode; currency: CurrencyCode }
  | { reason: "lines" }
  | { reason: "quantity" };

export type CartAction =
  | { type: "add"; line: CartLine }
  | { type: "setQuantity"; index: number; quantity: number }
  | { type: "setAnswers"; index: number; answers: FieldDrafts }
  /** A new size for a line by size; undefined while it is half typed. */
  | { type: "setSize"; index: number; size?: LineSize }
  | { type: "remove"; index: number }
  | { type: "clear" }
  /** Replace the whole cart (another tab changed it). Checked like a stored cart. */
  | { type: "replace"; cart: Cart };

export type CartResult =
  { ok: true; cart: Cart } | { ok: false; cart: Cart; refusal: CartRefusal };

/**
 * Two adds are one line when they buy the same price, at the same size, with
 * the same answers. Different answers or sizes are different lines: two
 * shirts, two logos; a 3 × 6 ft banner and a 4 × 8 ft one.
 */
const sameLine = (
  a: CartLine,
  b: Pick<CartLine, "listingId" | "priceId" | "answers" | "size">
) =>
  a.listingId === b.listingId &&
  a.priceId === b.priceId &&
  sizeKey(a.size) === sizeKey(b.size) &&
  draftsKey(a.answers) === draftsKey(b.answers);

/** A line's identity in the cart (it changes as its size or answers do). */
export const cartLineKey = (line: CartLine) =>
  `${line.listingId}:${line.priceId}:${sizeKey(line.size)}:${draftsKey(line.answers)}`;

const validQuantity = (n: number) =>
  Number.isInteger(n) && n >= 1 && n <= MAX_LINE_QUANTITY;

/**
 * Puts an edited line back where it was. Edited into a twin of another line
 * (the same answers, the same size), the two are one line at the summed
 * quantity, as an add would make, kept where it is edited.
 */
function replaceLine(cart: Cart, index: number, next: CartLine): CartResult {
  const edited = cart.lines[index]!;
  const twin = cart.lines.findIndex((l, i) => i !== index && sameLine(l, next));
  if (twin >= 0) {
    const quantity = edited.quantity + cart.lines[twin]!.quantity;
    if (!validQuantity(quantity))
      return { ok: false, cart, refusal: { reason: "quantity" } };
    next = { ...next, quantity };
  }
  const lines = cart.lines.slice();
  lines[index] = next;
  return {
    ok: true,
    cart: { lines: twin >= 0 ? lines.filter((_, i) => i !== twin) : lines },
  };
}

/**
 * Applies one change to a cart, or says why it can't. A cart that breaks a
 * rule checkout enforces is never produced: one currency, at most 50 lines,
 * 1 to 999 of each. Adding what is already in the cart adds to its quantity.
 * An unchanged cart comes back as the same object.
 */
export function applyCartAction(cart: Cart, action: CartAction): CartResult {
  switch (action.type) {
    case "add": {
      const { line } = action;
      if (!validQuantity(line.quantity))
        return { ok: false, cart, refusal: { reason: "quantity" } };
      const current = cartCurrency(cart);
      if (current && current !== line.currency)
        return {
          ok: false,
          cart,
          refusal: {
            reason: "currency",
            cartCurrency: current,
            currency: line.currency,
          },
        };
      const index = cart.lines.findIndex((l) => sameLine(l, line));
      if (index >= 0) {
        const quantity = cart.lines[index]!.quantity + line.quantity;
        if (!validQuantity(quantity))
          return { ok: false, cart, refusal: { reason: "quantity" } };
        const lines = cart.lines.slice();
        // The newest copy of what the listing says, at the summed quantity.
        lines[index] = { ...line, quantity };
        return { ok: true, cart: { lines } };
      }
      if (cart.lines.length >= MAX_CART_LINES)
        return { ok: false, cart, refusal: { reason: "lines" } };
      return { ok: true, cart: { lines: [...cart.lines, line] } };
    }
    case "setQuantity": {
      const line = cart.lines[action.index];
      if (!line) return { ok: true, cart };
      if (!validQuantity(action.quantity))
        return { ok: false, cart, refusal: { reason: "quantity" } };
      if (line.quantity === action.quantity) return { ok: true, cart };
      const lines = cart.lines.slice();
      lines[action.index] = { ...line, quantity: action.quantity };
      return { ok: true, cart: { lines } };
    }
    case "setAnswers": {
      const edited = cart.lines[action.index];
      if (!edited) return { ok: true, cart };
      return replaceLine(cart, action.index, {
        ...edited,
        answers: action.answers,
      });
    }
    case "setSize": {
      const edited = cart.lines[action.index];
      if (!edited) return { ok: true, cart };
      if (sizeKey(edited.size) === sizeKey(action.size))
        return { ok: true, cart };
      const { size: _old, ...rest } = edited;
      return replaceLine(
        cart,
        action.index,
        action.size ? { ...rest, size: action.size } : rest
      );
    }
    case "remove":
      if (!cart.lines[action.index]) return { ok: true, cart };
      return {
        ok: true,
        cart: { lines: cart.lines.filter((_, i) => i !== action.index) },
      };
    case "clear":
      return { ok: true, cart: cart.lines.length ? EMPTY_CART : cart };
    case "replace":
      return { ok: true, cart: sanitizeCart(action.cart) };
  }
}

/** What a refusal says to the shopper. */
export function refusalMessage(refusal: CartRefusal): string {
  switch (refusal.reason) {
    case "currency":
      return `Your cart is in ${refusal.cartCurrency} and this is priced in ${refusal.currency}. One order is paid in one currency: check out or empty the cart first.`;
    case "lines":
      return `A cart holds at most ${MAX_CART_LINES} different items. Check out these first.`;
    case "quantity":
      return `You can order 1 to ${MAX_LINE_QUANTITY} of an item.`;
  }
}

// ─── Stored carts ────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const optionalNumber = (v: unknown) => v === undefined || typeof v === "number";
const includes = (list: readonly string[], v: unknown) =>
  typeof v === "string" && list.includes(v);

/** A stored rate that can still draw its table: a known basis and tiers. */
const isRate = (value: unknown): value is PricingRate =>
  isRecord(value) &&
  includes(PRICING_BASES, value.basis) &&
  (value.unit === undefined || includes(PRICING_UNITS, value.unit)) &&
  Array.isArray(value.tiers) &&
  value.tiers.every(isRecord);

/** A stored size with a known unit and only numbers for its measures. */
const isSize = (value: unknown): value is LineSize =>
  isRecord(value) &&
  includes(PRICING_UNITS, value.unit) &&
  (value.basis === undefined || includes(PRICING_BASES, value.basis)) &&
  ["amount", "length", "width", "height", "depth"].every((k) =>
    optionalNumber(value[k])
  );

const isDeposit = (value: unknown): value is Deposit =>
  isRecord(value) && includes(DEPOSIT_KINDS, value.kind);

/**
 * The stored form and answers, kept only where they still fit together: a
 * form field that can't be drawn is dropped with its answer, and an answer
 * its field's input can't hold is dropped alone (the line asks again).
 */
function storedForm(v: Record<string, unknown>): Partial<CartLine> {
  if (!Array.isArray(v.form)) return {};
  const form = v.form.filter(isFormField);
  if (form.length === 0) return {};
  const raw = isRecord(v.answers) ? v.answers : {};
  const answers: FieldDrafts = {};
  for (const field of form) {
    const key = field.fieldKey!;
    if (key in raw && draftFits(field, raw[key]))
      answers[key] = raw[key] as FieldDrafts[string];
  }
  return { form, ...(Object.keys(answers).length ? { answers } : {}) };
}

function isCartLine(value: unknown): value is CartLine {
  if (!isRecord(value)) return false;
  const v = value;
  return (
    typeof v.listingId === "string" &&
    v.listingId !== "" &&
    typeof v.priceId === "string" &&
    v.priceId !== "" &&
    typeof v.quantity === "number" &&
    validQuantity(v.quantity) &&
    typeof v.name === "string" &&
    typeof v.optionLabel === "string" &&
    typeof v.unitAmountCents === "number" &&
    // Any ISO 4217 code: the server is the judge of which it sells in.
    typeof v.currency === "string" &&
    /^[A-Z]{3}$/.test(v.currency) &&
    (v.imageUrl === undefined || typeof v.imageUrl === "string") &&
    (v.optionId === undefined || typeof v.optionId === "string")
  );
}

/** A stored line with only what still reads back cleanly. */
function storedLine(line: CartLine): CartLine {
  const v = line as unknown as Record<string, unknown>;
  const {
    form: _form,
    answers: _answers,
    paymentTiming,
    deposit,
    rate,
    size,
    ...rest
  } = line;
  return {
    ...rest,
    ...storedForm(v),
    ...(includes(PAYMENT_TIMINGS, paymentTiming) ? { paymentTiming } : {}),
    ...(isDeposit(deposit) ? { deposit } : {}),
    ...(isRate(rate) ? { rate } : {}),
    // A size only means something beside the rate that asks for it.
    ...(isRate(rate) && isSize(size) ? { size } : {}),
  };
}

/**
 * A cart from untrusted data (storage, another tab), checked line by line
 * and replayed through the same rules, so a hand-edited or outdated entry
 * can't produce a cart checkout would refuse.
 */
export function sanitizeCart(value: unknown): Cart {
  const lines = isRecord(value) ? value.lines : undefined;
  if (!Array.isArray(lines)) return EMPTY_CART;
  let cart: Cart = EMPTY_CART;
  for (const line of lines) {
    if (!isCartLine(line)) continue;
    cart = applyCartAction(cart, { type: "add", line: storedLine(line) }).cart;
  }
  return cart;
}

/** The cart saved as JSON, or an empty one. */
export function parseStoredCart(raw: string | null | undefined): Cart {
  if (!raw) return EMPTY_CART;
  try {
    return sanitizeCart(JSON.parse(raw));
  } catch {
    return EMPTY_CART;
  }
}

// ─── Requests ────────────────────────────────────────────────────────────────

/** The shopper's details for checkout. */
export interface CheckoutContact {
  name: string;
  email: string;
  phone?: string;
  note?: string;
}

/** How the order gets there: a method the shipping options offered. */
export interface CheckoutShipping {
  methodId: string;
  /** Only for a delivered method; a pickup sends none (a 400 otherwise). */
  address?: Address;
}

/** What the checkout step adds to a quote: the delivery choice, and tax. */
export interface QuoteCheckout {
  shipping?: CheckoutShipping;
  includeTax?: boolean;
}

/**
 * The lines as checkout and the quotes want them. A quote prices the goods
 * only, so `withAnswers: false` leaves the answers out of it. Every one
 * carries the same `size`: the server charges at checkout what it quoted.
 */
export function checkoutLines(
  cart: Cart,
  { withAnswers = true } = {}
): CheckoutLineRequest[] {
  return cart.lines.map(
    ({ listingId, priceId, quantity, form, answers, size }) => {
      const fields = withAnswers
        ? answersForCheckout(form ?? [], answers)
        : undefined;
      return {
        listingId,
        priceId,
        quantity,
        ...(size ? { size } : {}),
        ...(fields ? { fields } : {}),
      };
    }
  );
}

/** An address with its blanks left out; undefined when nothing is filled. */
export function trimmedAddress(address: Address): Address | undefined {
  const out: Address = {};
  for (const [key, value] of Object.entries(address) as [
    keyof Address,
    string | undefined,
  ][]) {
    const trimmed = value?.trim();
    if (trimmed) out[key] = key === "country" ? trimmed.toUpperCase() : trimmed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The body for `POST /public/stores/{storeId}/quote`, or undefined when there
 * is nothing it could price: an empty cart (a 400), or a line by size still
 * waiting for its size (a 400 keyed `lines[i].size`; the line says so).
 *
 * At the checkout step it also carries the delivery choice, exactly as
 * `checkoutRequest` sends it, and `includeTax`. While the shopper is still
 * choosing, neither is sent: a tax quote is a calculation on the shop's
 * payment account, so `includeTax` waits until delivery is chosen.
 */
export function quoteRequest(
  cart: Cart,
  checkout?: QuoteCheckout
): QuoteRequest | undefined {
  if (cart.lines.length === 0) return undefined;
  if (cart.lines.some(lineNeedsSize)) return undefined;
  const shipping = checkout?.shipping;
  const address = shipping?.address && trimmedAddress(shipping.address);
  return {
    lines: checkoutLines(cart, { withAnswers: false }),
    ...(shipping ? { shippingMethodId: shipping.methodId } : {}),
    ...(shipping && address ? { shippingAddress: address } : {}),
    ...(checkout?.includeTax ? { includeTax: true } : {}),
  };
}

/**
 * Each cart line's quoted figures, by position, from a quote made for
 * `sent`. A line the quote was not made for (its price, quantity or size has
 * changed since, or lines moved) gets undefined: a newer quote is on its
 * way, and an old figure must not stand beside a new size.
 */
export function quotedLines(
  sent: CheckoutLineRequest[],
  quoted: QuoteLine[] | undefined,
  lines: CartLine[]
): (QuoteLine | undefined)[] {
  return lines.map((line, i) => {
    const asked = sent[i];
    if (
      !asked ||
      asked.listingId !== line.listingId ||
      asked.priceId !== line.priceId ||
      asked.quantity !== line.quantity ||
      sizeKey(asked.size) !== sizeKey(line.size)
    )
      return undefined;
    return quoted?.[i];
  });
}

/** The checkout request: the lines as checkout wants them, blanks left out. */
export function checkoutRequest(
  cart: Cart,
  contact: CheckoutContact,
  shipping?: CheckoutShipping
): CheckoutRequest {
  const phone = contact.phone?.trim();
  const note = contact.note?.trim();
  const address = shipping?.address && trimmedAddress(shipping.address);
  return {
    lines: checkoutLines(cart),
    name: contact.name.trim(),
    email: contact.email.trim(),
    ...(phone ? { phone } : {}),
    ...(note ? { note } : {}),
    ...(shipping ? { shippingMethodId: shipping.methodId } : {}),
    ...(shipping && address ? { shippingAddress: address } : {}),
  };
}

/** The address the shipping options can use: none until a postal code is typed. */
export function shippingQuoteAddress(address: Address): Address | undefined {
  const trimmed = trimmedAddress(address);
  return trimmed?.postalCode ? trimmed : undefined;
}
