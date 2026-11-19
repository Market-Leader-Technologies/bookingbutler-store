import { describe, expect, it } from "vitest";
import {
  createStoreClient,
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  StoreApiError,
} from "@bookingbutler/store";
import { stubFetch } from "../helpers";

describe("createStoreClient", () => {
  it("normalizes the base URL", () => {
    expect(normalizeBaseUrl("https://api.x.test/")).toBe("https://api.x.test");
    expect(normalizeBaseUrl("https://api.x.test/api/v1/")).toBe(
      "https://api.x.test"
    );
  });

  it("defaults to the production API when no baseUrl is given", async () => {
    const urls: string[] = [];
    const fetchSpy = (async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ id: "s1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const c = createStoreClient({ storeId: "s1", fetch: fetchSpy });
    expect(DEFAULT_BASE_URL).toBe("https://api.bookingbutler.ai");
    expect(c.baseUrl).toBe("https://api.bookingbutler.ai");
    await c.getStore();
    expect(urls[0]).toBe(
      "https://api.bookingbutler.ai/api/v1/public/stores/s1"
    );
  });

  it("calls each public route with the right method, path and body", async () => {
    const stub = stubFetch({
      "GET /public/stores/{id}": () => ({ body: { id: "s 1" } }),
      "GET /public/stores/{id}/listings": () => ({ body: { listings: [] } }),
      "GET /public/stores/{id}/listings/{l}": () => ({ body: { id: "l1" } }),
      "POST /public/stores/{id}/quote": () => ({ body: { subtotalCents: 1 } }),
      "POST /public/stores/{id}/shipping-options": () => ({
        body: { configured: false },
      }),
      "POST /public/stores/{id}/checkout": () => ({
        status: 201,
        body: { checkoutUrl: "https://pay/x" },
      }),
      "POST /public/stores/{id}/uploads": () => ({
        status: 201,
        body: { uploadToken: "t" },
      }),
      "GET /public/orders/{t}": () => ({ body: { token: "t" } }),
    });
    const c = createStoreClient({
      storeId: "s 1",
      baseUrl: "https://api.test/",
      fetch: stub.fetch,
    });
    await c.getStore();
    await c.listListings({
      q: "shirt",
      categoryId: "c",
      limit: 24,
      offset: undefined,
    });
    await c.getListing("l1");
    await c.quote({ lines: [{ listingId: "l", priceId: "p", quantity: 1 }] });
    await c.getShippingOptions({ lines: [] });
    await c.checkout({ name: "a", email: "b@c.d", lines: [] });
    await c.uploadFile(new Blob(["x"], { type: "image/png" }), {
      fileName: "a.png",
    });
    await c.getOrder("t");
    expect(stub.calls.map((x) => `${x.method} ${x.url}`)).toEqual([
      "GET https://api.test/api/v1/public/stores/s%201",
      "GET https://api.test/api/v1/public/stores/s%201/listings?q=shirt&categoryId=c&limit=24",
      "GET https://api.test/api/v1/public/stores/s%201/listings/l1",
      "POST https://api.test/api/v1/public/stores/s%201/quote",
      "POST https://api.test/api/v1/public/stores/s%201/shipping-options",
      "POST https://api.test/api/v1/public/stores/s%201/checkout",
      "POST https://api.test/api/v1/public/stores/s%201/uploads",
      "GET https://api.test/api/v1/public/orders/t",
    ]);
    expect(stub.calls[3]!.body).toEqual({
      lines: [{ listingId: "l", priceId: "p", quantity: 1 }],
    });
    expect(stub.calls[6]!.body).toBeInstanceOf(FormData);
    expect((stub.calls[6]!.body as FormData).get("file")).toBeTruthy();
  });

  it("throws StoreApiError with the server's body, and status 0 for no answer", async () => {
    const stub = stubFetch({
      "POST /public/stores/{id}/quote": () => ({
        status: 400,
        body: { code: "STORE_CLOSED", error: "the store has closed" },
      }),
    });
    const c = createStoreClient({
      storeId: "s",
      baseUrl: "https://api.test",
      fetch: stub.fetch,
    });
    const e = await c.quote({ lines: [] }).catch((x) => x);
    expect(e).toBeInstanceOf(StoreApiError);
    expect(e).toMatchObject({
      status: 400,
      code: "STORE_CLOSED",
      message: "the store has closed",
    });

    const offline = createStoreClient({
      storeId: "s",
      baseUrl: "https://api.test",
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(offline.getStore()).rejects.toMatchObject({ status: 0 });
  });

  it("lets an abort through as an AbortError", async () => {
    const c = createStoreClient({
      storeId: "s",
      baseUrl: "https://api.test",
      fetch: async () => {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
    });
    await expect(c.getStore()).rejects.toMatchObject({ name: "AbortError" });
  });
});
