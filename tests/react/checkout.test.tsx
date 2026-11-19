import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createCart } from "@bookingbutler/store";
import { Cart, Checkout, StoreProvider } from "@bookingbutler/store/react";
import { BASE, line, quoteFor, sleep, STORE, stubFetch } from "../helpers";

const OPTIONS = {
  configured: true,
  currency: "USD",
  options: [
    {
      methodId: "pickup",
      kind: "pickup",
      name: "Pick up at the shop",
      chargeCents: 0,
    },
    {
      methodId: "van",
      kind: "local_delivery",
      name: "Local delivery",
      chargeCents: 1500,
    },
  ],
};

function mount({ configured = true }: { configured?: boolean } = {}) {
  const cart = createCart({ storeId: STORE, storage: null });
  cart.add(line({ quantity: 2 }));
  const stub = stubFetch({
    "POST /public/stores/{id}/shipping-options": () => ({
      body: configured ? OPTIONS : { configured: false, options: [] },
    }),
    "POST /public/stores/{id}/quote": ({ body }) => {
      const b = body as {
        lines: never[];
        includeTax?: boolean;
        shippingMethodId?: string;
      };
      return {
        body: quoteFor(b.lines, {
          subtotalCents: 3000,
          ...(b.includeTax
            ? {
                complete: true,
                taxCents: 240,
                totalCents: b.shippingMethodId === "van" ? 4740 : 3240,
                dueNowCents: b.shippingMethodId === "van" ? 4740 : 3240,
                taxNote: "Tax at 8%.",
                ...(b.shippingMethodId === "van"
                  ? {
                      shipping: {
                        methodId: "van",
                        name: "Local delivery",
                        chargeCents: 1500,
                      },
                    }
                  : {}),
              }
            : {}),
        }),
      };
    },
    "POST /public/stores/{id}/checkout": () => ({
      status: 201,
      body: { token: "tok", checkoutUrl: "https://pay.test/o/tok" },
    }),
  });
  const onCheckout = vi.fn();
  render(
    <StoreProvider
      storeId={STORE}
      baseUrl={BASE}
      fetch={stub.fetch}
      cart={cart}
    >
      <Cart />
      <Checkout onCheckout={onCheckout} />
    </StoreProvider>
  );
  const quotes = () => stub.calls.filter((c) => c.path.endsWith("/quote"));
  return { ...stub, cart, onCheckout, quotes };
}

const type = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("<Checkout>", () => {
  it("sends includeTax only after delivery is chosen, and shows the taxed total", async () => {
    const { quotes } = mount();
    await screen.findByLabelText(/Pick up at the shop/);
    await waitFor(() => expect(quotes().length).toBeGreaterThan(0));
    await sleep(500);
    // Shopping quotes only, so far.
    expect(
      quotes().every((q) => !(q.body as object).hasOwnProperty("includeTax"))
    ).toBe(true);
    expect(
      screen.getByText("Choose how the order gets to you to see the total.")
    ).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Pick up at the shop/));
    await waitFor(() =>
      expect(
        quotes().some((q) => (q.body as { includeTax?: boolean }).includeTax)
      ).toBe(true)
    );
    const taxed = quotes().find(
      (q) => (q.body as { includeTax?: boolean }).includeTax
    )!;
    expect(taxed.body).toEqual({
      lines: [{ listingId: "listing-1", priceId: "price-1", quantity: 2 }],
      shippingMethodId: "pickup",
      includeTax: true,
    });
    const totals = await screen.findByRole("region", { name: "Order total" });
    await waitFor(() => expect(totals.textContent).toContain("$32.40"));
    expect(totals.textContent).toContain("$2.40");
    expect(totals.textContent).toContain("Tax at 8%.");
  });

  it("a delivery waits for the address before quoting tax", async () => {
    const { quotes } = mount();
    fireEvent.click(await screen.findByLabelText(/Local delivery/));
    await sleep(600);
    expect(
      quotes().some((q) => (q.body as { includeTax?: boolean }).includeTax)
    ).toBe(false);
    expect(
      screen.getByText("Enter the delivery address to see the total.")
    ).toBeTruthy();
    type("Street", "1 Main St");
    type("City", "Denver");
    type("Postal code", "80202");
    await waitFor(
      () => {
        const taxed = quotes().filter(
          (q) => (q.body as { includeTax?: boolean }).includeTax
        );
        expect(taxed.at(-1)?.body).toMatchObject({
          shippingMethodId: "van",
          shippingAddress: {
            street1: "1 Main St",
            city: "Denver",
            postalCode: "80202",
          },
        });
      },
      { timeout: 3000 }
    );
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Order total" }).textContent
      ).toContain("$47.40")
    );
  });

  it("a store with no delivery methods quotes tax at once (pickup)", async () => {
    const { quotes } = mount({ configured: false });
    await waitFor(
      () =>
        expect(
          quotes().some((q) => (q.body as { includeTax?: boolean }).includeTax)
        ).toBe(true),
      { timeout: 3000 }
    );
    const taxed = quotes().find(
      (q) => (q.body as { includeTax?: boolean }).includeTax
    )!;
    expect(taxed.body).not.toHaveProperty("shippingMethodId");
    expect(screen.queryByRole("group", { name: "Delivery" })).toBeNull();
  });

  it("checks the form, then sends lines without amounts and hands over the pay URL", async () => {
    const { calls, onCheckout, cart } = mount();
    fireEvent.click(await screen.findByLabelText(/Pick up at the shop/));
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to payment" })
    );
    expect(await screen.findByText("Enter your name.")).toBeTruthy();
    expect(calls.some((c) => c.path.endsWith("/checkout"))).toBe(false);

    type("Name", "Ada Lovelace");
    type(/^Email/, "ada@example.com");
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to payment" })
    );
    await waitFor(() => expect(onCheckout).toHaveBeenCalled());
    const checkout = calls.find((c) => c.path.endsWith("/checkout"))!;
    expect(checkout.body).toEqual({
      lines: [{ listingId: "listing-1", priceId: "price-1", quantity: 2 }],
      name: "Ada Lovelace",
      email: "ada@example.com",
      shippingMethodId: "pickup",
    });
    expect(onCheckout.mock.calls[0]![0]).toBe("https://pay.test/o/tok");
    expect(cart.getSnapshot().lines).toHaveLength(0);
  });

  it("puts a refused line size on the cart line", async () => {
    const cart = createCart({ storeId: STORE, storage: null });
    cart.add(
      line({
        rate: {
          basis: "area",
          unit: "ft",
          tiers: [{ start: 0, unitAmountCents: 900 }],
        },
        size: { width: 4, unit: "ft" },
      })
    );
    const stub = stubFetch({
      "POST /public/stores/{id}/shipping-options": () => ({
        body: { configured: false },
      }),
      "POST /public/stores/{id}/quote": () => ({
        status: 400,
        body: {
          error: "validation failed",
          details: { "lines[0].size": "a height is needed" },
        },
      }),
    });
    render(
      <StoreProvider
        storeId={STORE}
        baseUrl={BASE}
        fetch={stub.fetch}
        cart={cart}
      >
        <Cart />
      </StoreProvider>
    );
    expect(
      await screen.findByText("A height is needed", {}, { timeout: 2000 })
    ).toBeTruthy();
    // No figures after a refused quote: no line amount, no subtotal.
    expect(document.querySelector(".bb-cart__amount")!.textContent).toBe("—");
    const subtotal = screen.getByText("Subtotal").nextElementSibling!;
    expect(subtotal.textContent).toBe("—");
  });
});
