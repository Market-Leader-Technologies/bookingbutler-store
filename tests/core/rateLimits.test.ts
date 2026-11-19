import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyError,
  createQuoter,
  createShippingQuoter,
  createStoreClient,
  quoteRequest,
  checkoutRequest,
  RATE_LIMIT_RETRIES,
  RATE_LIMIT_RETRY_MS,
  RATE_LIMITED_MESSAGE,
  shippingOptionsKey,
  StoreApiError,
  type Cart,
  type Quote,
  type QuoteRequest,
} from "@bookingbutler/store";
import { BASE, line, quoteFor, STORE, stubFetch } from "../helpers";

/** The API's 429 body. */
const limited = () =>
  new StoreApiError({
    status: 429,
    body: {
      error: "rate limit exceeded",
      message: "Too many requests. Please try again later.",
    },
  });

interface Pending {
  body: QuoteRequest;
  signal?: AbortSignal;
  resolve: (q: Quote) => void;
  reject: (e: unknown) => void;
}

function fakeClient() {
  const pending: Pending[] = [];
  const quote = vi.fn(
    (body: QuoteRequest, opts?: { signal?: AbortSignal }) =>
      new Promise<Quote>((resolve, reject) =>
        pending.push({ body, signal: opts?.signal, resolve, reject })
      )
  );
  return { client: { quote }, pending, quote };
}

const cartOf = (...lines: Cart["lines"]): Cart => ({ lines });
const at = (methodId: string) => ({
  checkout: { shipping: { methodId }, includeTax: true },
});
const answer = (p: Pending, extra: Partial<Quote> = {}) =>
  p.resolve(quoteFor(p.body.lines, { complete: true, ...extra }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a 429 from any public call", () => {
  it("is classified as rate-limited with a friendly sentence, the server's own kept", () => {
    const e = limited();
    expect(e.serverMessage).toBe("Too many requests. Please try again later.");
    expect(classifyError(e)).toEqual({
      kind: "rateLimited",
      message: RATE_LIMITED_MESSAGE,
    });
    expect(RATE_LIMITED_MESSAGE).toBe(
      "Too many requests just now. Try again in a moment."
    );
  });

  it("from the client: listings, store and order reads throw a 429 StoreApiError", async () => {
    vi.useRealTimers();
    const body = {
      error: "rate limit exceeded",
      message: "Too many requests. Please try again later.",
    };
    const stub = stubFetch({
      "GET /public/stores/{id}": () => ({ status: 429, body }),
      "GET /public/stores/{id}/listings": () => ({ status: 429, body }),
      "GET /public/orders/{t}": () => ({ status: 429, body }),
    });
    const c = createStoreClient({
      storeId: STORE,
      baseUrl: BASE,
      fetch: stub.fetch,
    });
    for (const call of [c.getStore(), c.listListings(), c.getOrder("t")]) {
      const e = await call.catch((x: unknown) => x);
      expect(classifyError(e).kind).toBe("rateLimited");
    }
  });
});

describe("quotes and the 429", () => {
  it("keep the last figures, ask again after a few seconds, and stop after a few tries", async () => {
    const { client, pending, quote } = fakeClient();
    const q = createQuoter({ client, reuseAnswers: true });
    const cart = cartOf(line());
    q.update(cart, at("pickup"));
    await vi.advanceTimersByTimeAsync(400);
    answer(pending[0]!, { totalCents: 1111 });
    await vi.advanceTimersByTimeAsync(0);
    expect(q.view().quote?.totalCents).toBe(1111);

    // A new choice is refused for now: the old figures are held, not dropped.
    q.update(cart, at("van"));
    await vi.advanceTimersByTimeAsync(400);
    pending[1]!.reject(limited());
    await vi.advanceTimersByTimeAsync(0);
    let v = q.view();
    expect(v.retrying).toBe(true);
    expect(v.failed).toBe(false);
    expect(v.error).toBeNull();
    expect(v.quote).toBeUndefined(); // not for the request as it stands
    expect(v.held?.totalCents).toBe(1111);
    expect(v.loading).toBe(true);

    // Nothing more until the wait is over.
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_RETRY_MS - 1);
    expect(quote).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(quote).toHaveBeenCalledTimes(3);
    expect(pending[2]!.body).toEqual(pending[1]!.body);

    // Bounded: after RATE_LIMIT_RETRIES more 429s it fails like any other.
    for (let i = 2; i < 2 + RATE_LIMIT_RETRIES; i++) {
      pending[i]!.reject(limited());
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_RETRY_MS);
    }
    expect(quote).toHaveBeenCalledTimes(2 + RATE_LIMIT_RETRIES);
    v = q.view();
    expect(v.retrying).toBe(false);
    expect(v.failed).toBe(true);
    expect(v.failure?.kind).toBe("rateLimited");
    expect(v.error).toBe(RATE_LIMITED_MESSAGE);
    expect(v.held).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(quote).toHaveBeenCalledTimes(2 + RATE_LIMIT_RETRIES);
  });

  it("a retry that succeeds shows the new figures", async () => {
    const { client, pending } = fakeClient();
    const q = createQuoter({ client });
    q.update(cartOf(line()));
    await vi.advanceTimersByTimeAsync(400);
    pending[0]!.reject(limited());
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_RETRY_MS);
    answer(pending[1]!, { subtotalCents: 999 });
    await vi.advanceTimersByTimeAsync(0);
    expect(q.view()).toMatchObject({
      subtotalCents: 999,
      retrying: false,
      failed: false,
      failure: null,
    });
  });

  it("a change during the wait asks for the change instead, after the usual pause", async () => {
    const { client, pending, quote } = fakeClient();
    const q = createQuoter({ client });
    q.update(cartOf(line()));
    await vi.advanceTimersByTimeAsync(400);
    pending[0]!.reject(limited());
    await vi.advanceTimersByTimeAsync(0);
    q.update(cartOf(line({ quantity: 3 })));
    await vi.advanceTimersByTimeAsync(400);
    expect(quote).toHaveBeenCalledTimes(2);
    expect(pending[1]!.body.lines[0]!.quantity).toBe(3);
  });
});

describe("the taxed quote never asks twice for what it was answered", () => {
  it("going back to a choice shows its answer again without a request", async () => {
    const { client, pending, quote } = fakeClient();
    const q = createQuoter({ client, reuseAnswers: true });
    const cart = cartOf(line());
    q.update(cart, at("pickup"));
    await vi.advanceTimersByTimeAsync(400);
    answer(pending[0]!, { totalCents: 100 });
    q.update(cart, at("van"));
    await vi.advanceTimersByTimeAsync(400);
    answer(pending[1]!, { totalCents: 200 });
    await vi.advanceTimersByTimeAsync(0);
    q.update(cart, at("pickup"));
    expect(q.view().quote?.totalCents).toBe(100); // at once, no pause
    q.update(cart, at("van"));
    expect(q.view().quote?.totalCents).toBe(200);
    await vi.advanceTimersByTimeAsync(5000);
    expect(quote).toHaveBeenCalledTimes(2);

    // "Try again" still asks anew.
    q.refetch();
    await vi.advanceTimersByTimeAsync(400);
    expect(quote).toHaveBeenCalledTimes(3);
  });

  it("a request in flight is let finish and remembered, and never sent again", async () => {
    const { client, pending, quote } = fakeClient();
    const q = createQuoter({ client, reuseAnswers: true });
    const cart = cartOf(line());
    q.update(cart, at("pickup"));
    await vi.advanceTimersByTimeAsync(400);
    q.update(cart, at("van")); // pickup still in flight
    expect(pending[0]!.signal?.aborted ?? false).toBe(false);
    q.update(cart, at("pickup")); // and back before it answers
    await vi.advanceTimersByTimeAsync(400);
    expect(quote).toHaveBeenCalledTimes(1);
    answer(pending[0]!, { totalCents: 321 });
    await vi.advanceTimersByTimeAsync(0);
    expect(q.view().quote?.totalCents).toBe(321);
  });

  it("without reuseAnswers (the cart quote) newest still wins by aborting", async () => {
    const { client, pending } = fakeClient();
    const q = createQuoter({ client });
    q.update(cartOf(line()));
    await vi.advanceTimersByTimeAsync(400);
    q.update(cartOf(line({ quantity: 2 })));
    expect(pending[0]!.signal?.aborted).toBe(true);
  });
});

describe("the taxed quote body is what the checkout sends", () => {
  it("same lines, method and address (trimmed alike), plus includeTax", () => {
    const cart = cartOf(
      line({
        quantity: 2,
        form: [{ fieldKey: "logo" }],
        answers: { logo: "x" },
      })
    );
    const shipping = {
      methodId: "van",
      address: {
        street1: " 1 Main St ",
        city: "Denver",
        postalCode: "80202",
        country: "us",
        street2: " ",
      },
    };
    const quote = quoteRequest(cart, { shipping, includeTax: true })!;
    const checkout = checkoutRequest(
      cart,
      { name: "A", email: "a@b.co" },
      shipping
    );
    expect(quote.includeTax).toBe(true);
    expect(quote.shippingMethodId).toBe(checkout.shippingMethodId);
    expect(quote.shippingAddress).toEqual(checkout.shippingAddress);
    expect(quote.shippingAddress).toEqual({
      street1: "1 Main St",
      city: "Denver",
      postalCode: "80202",
      country: "US",
    });
    // The goods: the same lines, without the answers (which price nothing).
    expect(quote.lines).toEqual(
      checkout.lines.map(({ fields: _f, ...rest }) => rest)
    );
  });

  it("is sent as JSON", async () => {
    vi.useRealTimers();
    const stub = stubFetch({
      "POST /public/stores/{id}/quote": ({ body }) => ({
        body: quoteFor((body as QuoteRequest).lines),
      }),
    });
    const c = createStoreClient({
      storeId: STORE,
      baseUrl: BASE,
      fetch: stub.fetch,
    });
    await c.quote({
      lines: [{ listingId: "l", priceId: "p", quantity: 1 }],
      includeTax: true,
    });
    expect(stub.calls[0]!.headers["content-type"]).toBe("application/json");
    expect(typeof (stub.calls[0]! as { body: unknown }).body).toBe("object");
  });
});

describe("shipping options", () => {
  it("say which cart and address they answer", async () => {
    const getShippingOptions = vi.fn(async () => ({
      configured: true,
      options: [],
    }));
    const s = createShippingQuoter({ client: { getShippingOptions } });
    const cart = cartOf(line());
    const address = { street1: "1 Main", postalCode: "80202" };
    s.update(cart, address);
    expect(s.getState().loading).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(s.getState().answeredFor).toBe(shippingOptionsKey(cart, address));
    s.update(cart, { ...address, city: "Denver" });
    expect(s.getState().answeredFor).not.toBe(
      shippingOptionsKey(cart, { ...address, city: "Denver" })
    );
  });

  it("a 429 keeps the last options and asks again after a few seconds", async () => {
    let n = 0;
    const getShippingOptions = vi.fn(async () => {
      n += 1;
      if (n === 2) throw limited();
      return { configured: true, options: [{ methodId: `m${n}` }] };
    });
    const s = createShippingQuoter({ client: { getShippingOptions } });
    const cart = cartOf(line());
    s.update(cart, {});
    await vi.advanceTimersByTimeAsync(400);
    s.update(cart, { postalCode: "80202" });
    await vi.advanceTimersByTimeAsync(400);
    expect(s.getState()).toMatchObject({
      retrying: true,
      loading: true,
      error: null,
      options: { options: [{ methodId: "m1" }] },
    });
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_RETRY_MS);
    expect(getShippingOptions).toHaveBeenCalledTimes(3);
    expect(s.getState()).toMatchObject({
      retrying: false,
      loading: false,
      options: { options: [{ methodId: "m3" }] },
    });
  });
});
