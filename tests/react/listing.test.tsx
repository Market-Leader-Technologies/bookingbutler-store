import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import { createCart, type Listing } from "@bookingbutler/store";
import { ListingDetail, StoreProvider } from "@bookingbutler/store/react";
import { BASE, listing, STORE, stubFetch } from "../helpers";

const banner: Listing = {
  id: "vinyl",
  name: "Vinyl banner",
  currency: "USD",
  optionNames: [],
  options: [
    {
      id: "opt",
      prices: [
        {
          id: "price-sz",
          currency: "USD",
          unitAmountCents: 900,
          rate: {
            basis: "area",
            unit: "ft",
            tiers: [
              { start: 0, unitAmountCents: 900 },
              { start: 50, unitAmountCents: 750 },
            ],
          },
        },
      ],
      fields: [
        {
          fieldKey: "wording",
          name: "Wording",
          type: "string",
          required: true,
        },
      ],
    },
  ],
};

function mount(l: Listing) {
  const cart = createCart({ storeId: STORE, storage: null });
  const stub = stubFetch({
    "POST /public/stores/{id}/quote": ({ body }) => {
      const sent = (
        body as { lines: { quantity: number; size?: { amount?: number } }[] }
      ).lines[0]!;
      // The server prices it; the test just answers per size.
      const each = sent.size?.amount === 96 ? 72000 : 10800;
      return {
        body: {
          currency: "USD",
          lines: [
            {
              ...sent,
              unitAmountCents: each,
              amountCents: each * sent.quantity,
            },
          ],
          subtotalCents: each * sent.quantity,
        },
      };
    },
  });
  render(
    <StrictMode>
      <StoreProvider
        storeId={STORE}
        baseUrl={BASE}
        fetch={stub.fetch}
        cart={cart}
      >
        <ListingDetail listing={l} cartHref="/cart" />
      </StoreProvider>
    </StrictMode>
  );
  return { ...stub, cart };
}

describe("<ListingDetail>", () => {
  it("prices a typed size with a one-line quote and keeps a half-typed draft", async () => {
    const { calls, cart } = mount(banner);
    expect(screen.getByText("from $9.00 / sq ft")).toBeTruthy();
    expect(screen.getByText("Enter the size to see the price.")).toBeTruthy();
    const amount = screen.getByLabelText("How many sq ft?") as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "9." } });
    expect(amount.value).toBe("9.");
    fireEvent.change(amount, { target: { value: "96" } });
    await screen.findByText("$720.00", {}, { timeout: 2000 });
    const quotes = calls.filter((c) => c.path.endsWith("/quote"));
    expect(quotes.at(-1)!.body).toEqual({
      lines: [
        {
          listingId: "vinyl",
          priceId: "price-sz",
          quantity: 1,
          size: { amount: 96, basis: "area", unit: "ft" },
        },
      ],
    });
    expect(quotes.every((q) => !("includeTax" in (q.body as object)))).toBe(
      true
    );

    // Required wording: the add is refused and said on the field.
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    expect(await screen.findByText("Fill this in.")).toBeTruthy();
    expect(cart.getSnapshot().lines).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/Wording/), {
      target: { value: "GRAND OPENING" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    await waitFor(() => expect(cart.getSnapshot().lines).toHaveLength(1));
    expect(cart.getSnapshot().lines[0]).toMatchObject({
      listingId: "vinyl",
      priceId: "price-sz",
      size: { amount: 96, basis: "area", unit: "ft" },
      answers: { wording: "GRAND OPENING" },
    });
    expect(screen.getByText(/Added to your cart\./)).toBeTruthy();
  });

  it("switches option and price with the option buttons", () => {
    const { cart } = mount(listing);
    expect(screen.getByText("$15.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Large" }));
    expect(
      screen.getByRole("button", { name: "Large" }).getAttribute("aria-pressed")
    ).toBe("true");
    expect(screen.getByText("$25.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    expect(cart.getSnapshot().lines[0]).toMatchObject({
      priceId: "price-2",
      optionId: "opt-l",
      optionLabel: "Size: Large",
    });
  });
});
