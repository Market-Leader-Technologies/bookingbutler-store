import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createCart, type CartStore } from "@bookingbutler/store";
import {
  ListingGrid,
  StoreProvider,
  useCart,
  useCartQuote,
  useListing,
  useListings,
  useStore,
} from "@bookingbutler/store/react";
import { BASE, line, listing, quoteFor, STORE, stubFetch } from "../helpers";

function setup(routes: Parameters<typeof stubFetch>[0], cart?: CartStore) {
  const stub = stubFetch(routes);
  const theCart = cart ?? createCart({ storeId: STORE, storage: null });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StoreProvider
      storeId={STORE}
      baseUrl={BASE}
      fetch={stub.fetch}
      cart={theCart}
    >
      {children}
    </StoreProvider>
  );
  return { ...stub, wrapper, cart: theCart };
}

describe("data hooks", () => {
  it("useStore, useListings and useListing read through the stubbed fetch", async () => {
    const { wrapper, calls } = setup({
      "GET /public/stores/{id}": () => ({
        body: { id: STORE, name: "Example Sign Co" },
      }),
      "GET /public/stores/{id}/listings": () => ({
        body: { listings: [listing], total: 1, hasMore: false },
      }),
      "GET /public/stores/{id}/listings/{l}": () => ({ body: listing }),
    });
    const { result } = renderHook(
      () => ({
        store: useStore(),
        listings: useListings({ q: "banner" }),
        listing: useListing("listing-1"),
      }),
      { wrapper }
    );
    expect(result.current.listings.loading).toBe(true);
    await waitFor(() =>
      expect(result.current.listings.listings).toHaveLength(1)
    );
    await waitFor(() =>
      expect(result.current.store.store?.name).toBe("Example Sign Co")
    );
    await waitFor(() =>
      expect(result.current.listing.listing?.id).toBe("listing-1")
    );
    expect(calls.some((c) => c.url.endsWith("/listings?q=banner"))).toBe(true);
  });

  it("a 404 listing reads as notFound", async () => {
    const { wrapper } = setup({
      "GET /public/stores/{id}/listings/{l}": () => ({
        status: 404,
        body: { error: "not found" },
      }),
    });
    const { result } = renderHook(() => useListing("gone"), { wrapper });
    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.listing).toBeUndefined();
  });

  it("ListingGrid renders cards with the server's 'from' price, as links", async () => {
    const { wrapper } = setup({
      "GET /public/stores/{id}/listings": () => ({
        body: { listings: [listing], hasMore: false },
      }),
    });
    render(<ListingGrid href={(l) => `/shop/${l.id}`} />, { wrapper });
    const link = await screen.findByRole("link", { name: /Banner/ });
    expect(link.getAttribute("href")).toBe("/shop/listing-1");
    expect(link.textContent).toContain("From $15.00");
  });
});

describe("cart hooks", () => {
  it("useCart adds and merges; useCartQuote shows only the server's figures", async () => {
    const { wrapper, calls } = setup({
      "POST /public/stores/{id}/quote": ({ body }) => ({
        body: quoteFor((body as { lines: never[] }).lines, {
          subtotalCents: 3000,
        }),
      }),
    });
    const { result } = renderHook(
      () => ({ cart: useCart(), quote: useCartQuote() }),
      { wrapper }
    );
    expect(result.current.quote.subtotalCents).toBeUndefined();
    act(() => {
      result.current.cart.add(line({ quantity: 1 }));
      result.current.cart.add(line({ quantity: 1 }));
    });
    expect(result.current.cart.lines).toHaveLength(1);
    expect(result.current.cart.itemCount).toBe(2);
    await waitFor(() => expect(result.current.quote.subtotalCents).toBe(3000));
    const quotes = calls.filter((c) => c.path.endsWith("/quote"));
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.body).toEqual({
      lines: [{ listingId: "listing-1", priceId: "price-1", quantity: 2 }],
    });

    // Changing the quantity: the old subtotal is gone at once, then the new one lands.
    act(() => void result.current.cart.setQuantity(0, 3));
    expect(result.current.quote.subtotalCents).toBeUndefined();
    expect(result.current.quote.lines[0]).toBeUndefined();
    await waitFor(() =>
      expect(result.current.quote.lines[0]?.quantity).toBe(3)
    );
  });

  it("two useCartQuote callers share one request", async () => {
    const cart = createCart({ storeId: STORE, storage: null });
    cart.add(line());
    const { wrapper, calls } = setup(
      {
        "POST /public/stores/{id}/quote": ({ body }) => ({
          body: quoteFor((body as { lines: never[] }).lines),
        }),
      },
      cart
    );
    const { result } = renderHook(() => [useCartQuote(), useCartQuote()], {
      wrapper,
    });
    await waitFor(() => expect(result.current[1]!.quote).toBeDefined());
    expect(calls.filter((c) => c.path.endsWith("/quote"))).toHaveLength(1);
  });
});
