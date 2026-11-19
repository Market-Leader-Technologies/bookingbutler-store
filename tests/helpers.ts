import type { CartLine, Listing, Quote } from "@bookingbutler/store";

export const STORE = "store-1";
export const BASE = "https://api.test";

export function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    listingId: "listing-1",
    priceId: "price-1",
    quantity: 1,
    name: "Banner",
    optionLabel: "",
    unitAmountCents: 1500,
    currency: "USD",
    ...overrides,
  };
}

export const bySizeLine = (overrides: Partial<CartLine> = {}) =>
  line({
    listingId: "listing-sz",
    priceId: "price-sz",
    name: "Vinyl banner",
    rate: {
      basis: "area",
      unit: "ft",
      tiers: [{ start: 0, unitAmountCents: 900 }],
    },
    ...overrides,
  });

/** A quote shaped like the server's, for whatever lines were sent. */
export function quoteFor(
  lines: { listingId: string; priceId: string; quantity: number }[],
  extra: Partial<Quote> = {}
): Quote {
  return {
    currency: "USD",
    lines: lines.map((l, i) => ({
      ...l,
      unitAmountCents: 1000 + i,
      amountCents: (1000 + i) * l.quantity,
      dueNowCents: (1000 + i) * l.quantity,
      paymentTiming: "full_at_checkout",
    })),
    subtotalCents: 4242,
    dueNowCents: 4242,
    balanceCents: 0,
    taxCents: 0,
    totalCents: 4242,
    complete: false,
    ...extra,
  };
}

export const listing: Listing = {
  id: "listing-1",
  name: "Banner",
  currency: "USD",
  fromPriceCents: 1500,
  optionNames: ["Size"],
  options: [
    {
      id: "opt-s",
      options: { Size: "Small" },
      prices: [{ id: "price-1", unitAmountCents: 1500, currency: "USD" }],
    },
    {
      id: "opt-l",
      options: { Size: "Large" },
      prices: [{ id: "price-2", unitAmountCents: 2500, currency: "USD" }],
    },
  ],
};

export interface Call {
  method: string;
  url: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

type Handler = (call: Call) => Reply | Promise<Reply>;

/** A JSON answer, or a ready `Response` (a PDF, custom headers). */
type Reply = { status?: number; body?: unknown } | Response;

/**
 * A fetch stand-in routed by "METHOD /path" (the path after /api/v1),
 * recording every call with its parsed JSON body.
 */
export function stubFetch(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const path = new URL(url).pathname.replace(/^\/api\/v1/, "");
    let body: unknown = undefined;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    else if (init?.body) body = init.body;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(
      (init?.headers as Record<string, string> | undefined) ?? {}
    ))
      headers[k.toLowerCase()] = v;
    const call = { method, url, path, body, headers };
    calls.push(call);
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return (
        m === method &&
        new RegExp(`^${p!.replace(/\{[^}]+\}/g, "[^/]+")}$`).test(path)
      );
    });
    if (init?.signal?.aborted)
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    const res = key
      ? await routes[key]!(call)
      : { status: 404, body: { error: "no route" } };
    if (res instanceof Response) return res;
    return new Response(
      res.body === undefined ? "" : JSON.stringify(res.body),
      {
        status: res.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
