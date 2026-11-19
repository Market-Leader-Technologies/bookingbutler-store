import {
  cartLineName,
  checkoutLines,
  quotedLines,
  quoteRequest,
  shippingQuoteAddress,
  type Cart,
  type CartLine,
  type QuoteCheckout,
} from "./cart";
import type { StoreClient } from "./client";
import {
  classifyError,
  HTTP,
  isAbortError,
  isStoreApiError,
  type LineSizeErrors,
  type StoreFailure,
} from "./errors";
import type {
  Address,
  CheckoutLineRequest,
  Quote,
  QuoteLine,
  QuoteRequest,
  ShippingOptions,
} from "./types";

/** How long typing a size, quantity or address waits before asking again. */
export const QUOTE_DEBOUNCE_MS = 400;
/**
 * The pause before a taxed quote: longer, because each one is a calculation
 * on the shop's payment account and they have a tighter limit (20 in a
 * burst, then 1 every 5 seconds).
 */
export const TAXED_QUOTE_DEBOUNCE_MS = 800;
/** The wait before asking again after a 429 (the API sends no Retry-After). */
export const RATE_LIMIT_RETRY_MS = 5000;
/** How many times a rate-limited quote is asked again before giving up. */
export const RATE_LIMIT_RETRIES = 3;
/** How many answered requests a quoter with `reuseAnswers` remembers. */
const REMEMBERED_ANSWERS = 20;

type Listener = () => void;

// ─── Cart quote ──────────────────────────────────────────────────────────────

/** The newest answer, and exactly what it was asked for. */
export interface QuoteAnswer {
  sent: CheckoutLineRequest[];
  /** The whole request it answers, as one comparable value. */
  key: string;
  data: Quote;
}

export interface QuoterState {
  answer: QuoteAnswer | null;
  loading: boolean;
  /** A sentence for the shopper, or null. A size refusal is said on its line instead. */
  error: string | null;
  /** The refusal, classified, for the page to act on. */
  failure: StoreFailure | null;
  /** A 400 naming a line's size, by line. */
  sizeErrors: LineSizeErrors | undefined;
  /**
   * The last quote asked for failed and none has succeeded since. Show no
   * figures then: what the page could work out itself is exactly what the
   * server just declined to confirm.
   */
  failed: boolean;
  /**
   * The API answered 429 and the quote will be asked again in a few
   * seconds. The last answer is kept meanwhile (see `QuoteView.held`).
   */
  retrying: boolean;
}

/** The state, read against a cart as it is now. Every figure to show comes from here. */
export interface QuoteView extends QuoterState {
  /** The answer, only while it is for the request as it stands now. */
  quote: Quote | undefined;
  /** Each cart line's quoted figures; undefined where the answer is out of date. */
  lines: (QuoteLine | undefined)[];
  /** The quote's subtotal, only while it is for the cart as it is now. */
  subtotalCents: number | undefined;
  /**
   * While a rate-limited quote waits to be asked again (`retrying`), the
   * last figures, for an older request. Show them marked as updating, or
   * not at all; never as the answer for the cart as it is now.
   */
  held: Quote | undefined;
}

export const IDLE_QUOTE: QuoterState = Object.freeze({
  answer: null,
  loading: false,
  error: null,
  failure: null,
  sizeErrors: undefined,
  failed: false,
  retrying: false,
});

/** The request as one comparable value; empty when nothing can be quoted. */
export const quoteKey = (body: QuoteRequest | undefined): string =>
  body ? JSON.stringify(body) : "";

/**
 * A quoter's state read against `cart` (and the checkout choice) as they are
 * at this moment. An answer for an older request yields no quote, and each
 * line only the figures of a quote made for that very line, so a stale
 * answer never stands beside a changed cart, even for the instant before a
 * new request is sent.
 */
export function quoteView(
  state: QuoterState,
  cart: Cart,
  checkout?: QuoteCheckout,
  enabled = true
): QuoteView {
  const key = quoteKey(quoteRequest(cart, checkout));
  const answer = state.answer;
  const current = enabled && answer != null && key !== "" && answer.key === key;
  const quote = current ? answer.data : undefined;
  return {
    ...state,
    quote,
    lines:
      answer && enabled
        ? quotedLines(answer.sent, answer.data.lines, cart.lines)
        : cart.lines.map(() => undefined),
    subtotalCents: quote?.subtotalCents,
    held:
      enabled && state.retrying && answer && !current ? answer.data : undefined,
  };
}

export interface QuoterOptions {
  client: Pick<StoreClient, "quote">;
  debounceMs?: number;
  /**
   * Remember every answer by its request, and never send a request already
   * answered: going back to an earlier delivery choice or address shows its
   * answer again without asking. A request in flight is let finish (not
   * aborted) so its answer is remembered too. `refetch()` still asks anew.
   * For the taxed quote, where each request costs the shop a calculation.
   */
  reuseAnswers?: boolean;
  /** The wait before asking again after a 429. */
  retryMs?: number;
  /** How many times a 429 is asked again before giving up. */
  retries?: number;
}

export interface QuoteUpdate {
  /** The checkout step: the delivery chosen and `includeTax`. Leave out while shopping. */
  checkout?: QuoteCheckout;
  /** false stops quoting (and drops any answer from view). Default true. */
  enabled?: boolean;
  /** How a refusal names lines; defaults to each line's name and options. */
  lineNames?: string[];
}

export interface Quoter {
  /** Hand it the cart (and checkout choice) whenever they change. */
  update(cart: Cart, options?: QuoteUpdate): void;
  getState(): QuoterState;
  /** The state against the cart last passed to `update`. */
  view(): QuoteView;
  subscribe(listener: Listener): () => void;
  /** Ask again now (a "Try again" button). */
  refetch(): void;
  /** Stop: clear the timer, abort what is in flight. `update` starts it again. */
  cancel(): void;
}

/**
 * Prices a cart with `POST /quote`, asked again after a pause whenever the
 * goods change (debounced), the newest request winning: an older request is
 * aborted, and an answer that lands late is dropped. After a failure the
 * answer is cleared, so no figures stand that the server didn't confirm.
 *
 * A 429 is not a failure: the last answer is kept (`retrying`, and the view's
 * `held`) and the quote is asked again after `retryMs`, up to `retries`
 * times, then it fails like any other.
 *
 * Use one quoter for the cart (no `checkout`) and another for the checkout
 * step (`checkout: { shipping, includeTax: true }`, with `reuseAnswers`),
 * so a goods-only answer can never stand in for the taxed one.
 *
 * Nothing is sent for an empty cart, or while a line by size has no size.
 */
export function createQuoter({
  client,
  debounceMs = QUOTE_DEBOUNCE_MS,
  reuseAnswers = false,
  retryMs = RATE_LIMIT_RETRY_MS,
  retries = RATE_LIMIT_RETRIES,
}: QuoterOptions): Quoter {
  let state: QuoterState = IDLE_QUOTE;
  let cart: Cart = { lines: [] };
  let checkout: QuoteCheckout | undefined;
  let enabled = true;
  let lineNames: string[] | undefined;
  /** What was last scheduled; null after `cancel`, so `update` sends again. */
  let scheduled: string | null = null;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  /** 429s in a row for the request now asked. */
  let limited = 0;
  /** With `reuseAnswers`: answers by request key, oldest first. */
  const remembered = new Map<string, Quote>();
  /** With `reuseAnswers`: requests sent and not answered yet. */
  const inFlight = new Map<string, Promise<Quote>>();
  const listeners = new Set<Listener>();

  const set = (patch: Partial<QuoterState>) => {
    const next = { ...state, ...patch };
    if (
      (Object.keys(patch) as (keyof QuoterState)[]).every(
        (k) => state[k] === next[k]
      )
    )
      return;
    state = next;
    for (const l of [...listeners]) l();
  };

  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    // A remembered request is let finish: it was paid for.
    if (!reuseAnswers) controller?.abort();
    controller = undefined;
    seq += 1;
  };

  const remember = (key: string, data: Quote) => {
    remembered.delete(key);
    remembered.set(key, data);
    while (remembered.size > REMEMBERED_ANSWERS)
      remembered.delete(remembered.keys().next().value!);
  };

  const names = () => lineNames ?? cart.lines.map(cartLineName);

  const answered = (body: QuoteRequest, key: string, data: Quote) =>
    set({
      answer: { sent: body.lines, key, data },
      failed: false,
      error: null,
      failure: null,
      sizeErrors: undefined,
      loading: false,
      retrying: false,
    });

  const ask = (body: QuoteRequest, key: string, fresh: boolean) => {
    if (!reuseAnswers) {
      const c = new AbortController();
      controller = c;
      return client.quote(body, { signal: c.signal }).finally(() => {
        if (controller === c) controller = undefined;
      });
    }
    const pending = !fresh && inFlight.get(key);
    if (pending) return pending;
    const p = client.quote(body).then((data) => {
      remember(key, data);
      return data;
    });
    inFlight.set(key, p);
    const done = () => {
      if (inFlight.get(key) === p) inFlight.delete(key);
    };
    p.then(done, done);
    return p;
  };

  const schedule = ({ fresh = false, wait = debounceMs } = {}) => {
    stop();
    const mine = seq;
    const body = quoteRequest(cart, checkout);
    const key = quoteKey(body);
    if (!enabled || !body) {
      limited = 0;
      set({
        loading: false,
        error: null,
        failure: null,
        sizeErrors: undefined,
        retrying: false,
        // Nothing asked is nothing confirmed: a line waiting for its size
        // keeps a failure standing until a quote succeeds. Only an ended
        // cart (empty, or no longer quoting) starts over.
        ...(!enabled || cart.lines.length === 0 ? { failed: false } : {}),
      });
      return;
    }
    const known = reuseAnswers && !fresh ? remembered.get(key) : undefined;
    if (known) {
      limited = 0;
      answered(body, key, known);
      return;
    }
    set({ loading: true });
    timer = setTimeout(() => {
      timer = undefined;
      ask(body, key, fresh)
        .then((data) => {
          if (mine !== seq) return;
          limited = 0;
          answered(body, key, data);
        })
        .catch((err: unknown) => {
          if (mine !== seq || isAbortError(err)) return;
          const failure = classifyError(err, { lineNames: names() });
          if (failure.kind === "rateLimited" && limited < retries) {
            // Too many just now: keep the last figures and ask again soon.
            limited += 1;
            set({ retrying: true, failure, error: null });
            schedule({ fresh, wait: retryMs });
            return;
          }
          limited = 0;
          const badRequest =
            isStoreApiError(err) && err.status === HTTP.BAD_REQUEST;
          const sizeErrors =
            badRequest && failure.kind === "invalid"
              ? failure.lineSizes
              : undefined;
          set({
            // A refused or failed refresh leaves no figures to stand by.
            answer: null,
            failed: true,
            retrying: false,
            failure,
            sizeErrors,
            error: sizeErrors
              ? null
              : failure.kind === "other" &&
                  !(isStoreApiError(err) && err.serverMessage)
                ? "We couldn't price your cart. Try again."
                : failure.message,
            loading: false,
          });
        });
    }, wait);
  };

  const signature = () =>
    `${enabled}|${cart.lines.length === 0}|${quoteKey(quoteRequest(cart, checkout))}`;

  return {
    update(nextCart, options = {}) {
      cart = nextCart;
      checkout = options.checkout;
      enabled = options.enabled ?? true;
      lineNames = options.lineNames;
      const sig = signature();
      if (sig === scheduled) return;
      scheduled = sig;
      limited = 0;
      schedule();
    },
    getState: () => state,
    view: () => quoteView(state, cart, checkout, enabled),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refetch() {
      scheduled = signature();
      limited = 0;
      schedule({ fresh: true });
    },
    cancel() {
      stop();
      scheduled = null;
      limited = 0;
      set({ loading: false, retrying: false });
    },
  };
}

// ─── Shipping options ────────────────────────────────────────────────────────

export interface ShippingState {
  /** The newest answer, kept on screen while a newer one is asked for. */
  options: ShippingOptions | null;
  /**
   * What `options` answer: `shippingOptionsKey(cart, address)` of the
   * request. Compare it with the cart and address as they are now before
   * anything waits on the options (the taxed quote does).
   */
  answeredFor: string | null;
  loading: boolean;
  error: string | null;
  failure: StoreFailure | null;
  /** A 429: asked again in a few seconds, the last options kept meanwhile. */
  retrying: boolean;
}

export const IDLE_SHIPPING: ShippingState = Object.freeze({
  options: null,
  answeredFor: null,
  loading: false,
  error: null,
  failure: null,
  retrying: false,
});

/**
 * What the shipping options depend on, as one comparable value: the goods
 * (not the answers) and the address once it has a postal code.
 */
export function shippingOptionsKey(cart: Cart, address: Address): string {
  return JSON.stringify([
    checkoutLines(cart, { withAnswers: false }),
    shippingQuoteAddress(address) ?? null,
  ]);
}

export interface ShippingQuoter {
  /** Hand it the cart and the address as typed; blanks are trimmed away. */
  update(cart: Cart, address: Address, options?: { enabled?: boolean }): void;
  getState(): ShippingState;
  subscribe(listener: Listener): () => void;
  refetch(): void;
  cancel(): void;
}

/**
 * The store's delivery options for a cart and address
 * (`POST /shipping-options`), asked again whenever the goods or the address
 * change, after a pause in typing. The address is sent only once it has a
 * postal code (before that only pickup can be offered). Newest wins. A 429
 * keeps the last options and asks again after `retryMs`, up to `retries`.
 */
export function createShippingQuoter({
  client,
  debounceMs = QUOTE_DEBOUNCE_MS,
  retryMs = RATE_LIMIT_RETRY_MS,
  retries = RATE_LIMIT_RETRIES,
}: {
  client: Pick<StoreClient, "getShippingOptions">;
  debounceMs?: number;
  retryMs?: number;
  retries?: number;
}): ShippingQuoter {
  let state: ShippingState = IDLE_SHIPPING;
  let lines: CheckoutLineRequest[] = [];
  let address: Address | undefined;
  let enabled = true;
  let scheduled: string | null = null;
  let seq = 0;
  let limited = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const listeners = new Set<Listener>();

  const set = (patch: Partial<ShippingState>) => {
    state = { ...state, ...patch };
    for (const l of [...listeners]) l();
  };
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
    seq += 1;
  };
  const schedule = (wait = debounceMs) => {
    stop();
    const mine = seq;
    if (!enabled || lines.length === 0) {
      limited = 0;
      if (state.loading || state.retrying)
        set({ loading: false, retrying: false });
      return;
    }
    if (wait === debounceMs)
      set({ loading: true, error: null, failure: null, retrying: false });
    else set({ loading: true });
    const body = { lines, ...(address ? { address } : {}) };
    const key = JSON.stringify([lines, address ?? null]);
    timer = setTimeout(() => {
      timer = undefined;
      const c = new AbortController();
      controller = c;
      client
        .getShippingOptions(body, { signal: c.signal })
        .then((options) => {
          if (mine !== seq) return;
          limited = 0;
          set({
            options,
            answeredFor: key,
            loading: false,
            error: null,
            failure: null,
            retrying: false,
          });
        })
        .catch((err: unknown) => {
          if (mine !== seq || isAbortError(err)) return;
          const failure = classifyError(err);
          if (failure.kind === "rateLimited" && limited < retries) {
            limited += 1;
            set({ retrying: true, failure });
            schedule(retryMs);
            return;
          }
          limited = 0;
          set({
            loading: false,
            retrying: false,
            failure,
            error:
              failure.kind === "other" || failure.kind === "tax"
                ? "We couldn't get the delivery options. Try again."
                : failure.message,
          });
        });
    }, wait);
  };
  const signature = () =>
    `${enabled}|${JSON.stringify([lines, address ?? null])}`;

  return {
    update(cart, nextAddress, options = {}) {
      // What the options depend on: the goods (not the answers) and the address.
      lines = checkoutLines(cart, { withAnswers: false });
      address = shippingQuoteAddress(nextAddress);
      enabled = options.enabled ?? true;
      const sig = signature();
      if (sig === scheduled) return;
      scheduled = sig;
      limited = 0;
      schedule();
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refetch() {
      scheduled = signature();
      limited = 0;
      schedule();
    },
    cancel() {
      stop();
      scheduled = null;
      limited = 0;
      if (state.loading || state.retrying)
        set({ loading: false, retrying: false });
    },
  };
}

/** A one-line cart for quoting a listing's price at a size, before it is added. */
export function singleLineCart(
  line: Pick<CartLine, "listingId" | "priceId" | "quantity"> &
    Partial<Pick<CartLine, "rate" | "size">>
): Cart {
  return {
    lines: [
      {
        name: "",
        optionLabel: "",
        unitAmountCents: 0,
        currency: "USD",
        ...line,
      },
    ],
  };
}
