// @vitest-environment node
import { describe, expect, it } from "vitest";

describe("SSR safety", () => {
  it("imports and creates a client and a cart with no window", async () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe(
      "undefined"
    );
    const core = await import("@bookingbutler/store");
    const client = core.createStoreClient({
      storeId: "s",
      baseUrl: "https://x.test/",
    });
    expect(client.baseUrl).toBe("https://x.test");
    const cart = core.createCart({ storeId: "s" });
    expect(cart.getSnapshot()).toBe(core.EMPTY_CART);
    // A change on the server stays in memory and touches no storage.
    expect(
      cart.add({
        listingId: "l",
        priceId: "p",
        quantity: 1,
        name: "n",
        optionLabel: "",
        unitAmountCents: 1,
        currency: "USD",
      }).ok
    ).toBe(true);
    expect(() => core.redirectToCheckout("https://pay.test/x")).toThrow(
      /no window/
    );
  });

  it("the React entry imports without a DOM", async () => {
    const react = await import("@bookingbutler/store/react");
    expect(typeof react.StoreProvider).toBe("function");
  });
});
