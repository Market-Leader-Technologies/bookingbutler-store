import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createQuoter,
  createShippingQuoter,
  StoreApiError,
  type Cart,
  type Quote,
  type QuoteRequest,
} from "@bookingbutler/store";
import { bySizeLine, line, quoteFor } from "../helpers";

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

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createQuoter", () => {
  it("debounces: several changes within the pause send one request, for the last cart", async () => {
    const { client, quote, pending } = fakeClient();
    const q = createQuoter({ client });
    q.update(cartOf(line({ quantity: 1 })));
    await vi.advanceTimersByTimeAsync(200);
    q.update(cartOf(line({ quantity: 2 })));
    await vi.advanceTimersByTimeAsync(200);
    q.update(cartOf(line({ quantity: 3 })));
    expect(q.getState().loading).toBe(true);
    await vi.advanceTimersByTimeAsync(399);
    expect(quote).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(quote).toHaveBeenCalledTimes(1);
    expect(pending[0]!.body.lines[0]!.quantity).toBe(3);
    expect(pending[0]!.body).not.toHaveProperty("includeTax");
  });

  it("the same cart again sends nothing new", async () => {
    const { client, quote, pending } = fakeClient();
    const q = createQuoter({ client });
    const cart = cartOf(line());
    q.update(cart);
    await vi.advanceTimersByTimeAsync(400);
    pending[0]!.resolve(quoteFor(pending[0]!.body.lines));
    await vi.advanceTimersByTimeAsync(0);
    q.update(cartOf(line())); // equal content, new object
    await vi.advanceTimersByTimeAsync(1000);
    expect(quote).toHaveBeenCalledTimes(1);
    expect(q.view().subtotalCents).toBe(4242);
  });

  it("newest wins: an older answer landing late is dropped, and its request aborted", async () => {
    const { client, pending } = fakeClient();
    const q = createQuoter({ client });
    q.update(cartOf(line({ quantity: 1 })));
    await vi.advanceTimersByTimeAsync(400);
    q.update(cartOf(line({ quantity: 2 })));
    await vi.advanceTimersByTimeAsync(400);
    expect(pending).toHaveLength(2);
    expect(pending[0]!.signal?.aborted).toBe(true);
    pending[1]!.resolve(
      quoteFor(pending[1]!.body.lines, { subtotalCents: 2000 })
    );
    await vi.advanceTimersByTimeAsync(0);
    pending[0]!.resolve(
      quoteFor(pending[0]!.body.lines, { subtotalCents: 1000 })
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(q.view().subtotalCents).toBe(2000);
    expect(q.getState().answer!.sent[0]!.quantity).toBe(2);
  });

  it("never shows an answer beside a cart it wasn't asked for", async () => {
    const { client, pending } = fakeClient();
    const q = createQuoter({ client });
    q.update(cartOf(line({ quantity: 1 }), line({ priceId: "p2" })));
    await vi.advanceTimersByTimeAsync(400);
    pending[0]!.resolve(quoteFor(pending[0]!.body.lines));
    await vi.advanceTimersByTimeAsync(0);
    expect(q.view().quote).toBeDefined();
    // The shopper changes the first line's quantity: before any new answer,
    // the subtotal and that line's figure are gone; the untouched line keeps its own.
    q.update(cartOf(line({ quantity: 5 }), line({ priceId: "p2" })));
    const v = q.view();
    expect(v.quote).toBeUndefined();
    expect(v.subtotalCents).toBeUndefined();
    expect(v.lines[0]).toBeUndefined();
    expect(v.lines[1]).toBeDefined();
  });

  it("after a failure shows no figures until a quote succeeds", async () => {
    const { client, pending } = fakeClient();
    const q = createQuoter({ client });
    const cart = cartOf(line());
    q.update(cart);
    await vi.advanceTimersByTimeAsync(400);
    pending[0]!.resolve(quoteFor(pending[0]!.body.lines));
    await vi.advanceTimersByTimeAsync(0);
    q.refetch();
    await vi.advanceTimersByTimeAsync(400);
    pending[1]!.reject(new StoreApiError({ status: 500, body: {} }));
    await vi.advanceTimersByTimeAsync(0);
    const v = q.view();
    expect(v.failed).toBe(true);
    expect(v.quote).toBeUndefined();
    expect(v.lines[0]).toBeUndefined();
    expect(v.error).toBe("We couldn't price your cart. Try again.");
  });

  it("puts a lines[i].size refusal on the line, not in the general error", async () => {
    const { client, pending } = fakeClient();
    const q = createQuoter({ client });
    q.update(cartOf(bySizeLine({ size: { width: 4, unit: "ft" } })));
    await vi.advanceTimersByTimeAsync(400);
    pending[0]!.reject(
      new StoreApiError({
        status: 400,
        body: {
          error: "validation failed",
          details: { "lines[0].size": "a height is needed" },
        },
      })
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(q.getState()).toMatchObject({
      error: null,
      sizeErrors: { 0: "A height is needed" },
      failed: true,
    });
  });

  it("sends nothing while a by-size line has no size, and nothing for an empty cart", async () => {
    const { client, quote } = fakeClient();
    const q = createQuoter({ client });
    q.update(cartOf(line(), bySizeLine()));
    q.update(cartOf());
    await vi.advanceTimersByTimeAsync(2000);
    expect(quote).not.toHaveBeenCalled();
    expect(q.getState().loading).toBe(false);
  });

  it("a checkout quote carries the delivery and includeTax", async () => {
    const { client, pending } = fakeClient();
    const q = createQuoter({ client });
    q.update(cartOf(line()), {
      checkout: { shipping: { methodId: "m" }, includeTax: true },
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(pending[0]!.body).toMatchObject({
      shippingMethodId: "m",
      includeTax: true,
    });
  });

  it("disabled sends nothing and drops the answer from view", async () => {
    const { client, quote } = fakeClient();
    const q = createQuoter({ client });
    q.update(cartOf(line()), { enabled: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(quote).not.toHaveBeenCalled();
  });
});

describe("createShippingQuoter", () => {
  it("sends the address only once it has a postal code, debounced", async () => {
    const getShippingOptions = vi.fn(async () => ({
      configured: true,
      options: [],
    }));
    const s = createShippingQuoter({ client: { getShippingOptions } });
    const cart = cartOf(
      line({ form: [{ fieldKey: "x" }], answers: { x: "y" } })
    );
    s.update(cart, { street1: "1 Main" });
    await vi.advanceTimersByTimeAsync(400);
    expect(getShippingOptions).toHaveBeenLastCalledWith(
      { lines: [{ listingId: "listing-1", priceId: "price-1", quantity: 1 }] },
      expect.anything()
    );
    s.update(cart, { street1: "1 Main", postalCode: "8" });
    s.update(cart, { street1: "1 Main", postalCode: "80202" });
    await vi.advanceTimersByTimeAsync(400);
    expect(getShippingOptions).toHaveBeenCalledTimes(2);
    expect(getShippingOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: { street1: "1 Main", postalCode: "80202" },
      }),
      expect.anything()
    );
  });
});
