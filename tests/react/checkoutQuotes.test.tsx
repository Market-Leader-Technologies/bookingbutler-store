import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createCart, type QuoteRequest } from "@bookingbutler/store";
import { Checkout, StoreProvider } from "@bookingbutler/store/react";
import {
  BASE,
  line,
  quoteFor,
  sleep,
  STORE,
  stubFetch,
  type Call,
} from "../helpers";

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

type QuoteHandler = (
  body: QuoteRequest,
  n: number
) => { status?: number; body?: unknown };

const taxedAnswer: QuoteHandler = (b) => ({
  body: quoteFor(b.lines, {
    subtotalCents: 3000,
    ...(b.includeTax
      ? {
          complete: true,
          taxCents: 240,
          totalCents: b.shippingMethodId === "van" ? 4740 : 3240,
          dueNowCents: b.shippingMethodId === "van" ? 4740 : 3240,
        }
      : {}),
  }),
});

function mount(taxed: QuoteHandler = taxedAnswer) {
  const cart = createCart({ storeId: STORE, storage: null });
  cart.add(line({ quantity: 2 }));
  let n = 0;
  const stub = stubFetch({
    "POST /public/stores/{id}/shipping-options": () => ({ body: OPTIONS }),
    "POST /public/stores/{id}/quote": ({ body }) => {
      const b = body as QuoteRequest;
      return b.includeTax ? taxed(b, n++) : taxedAnswer(b, 0);
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
      <Checkout onCheckout={onCheckout} />
    </StoreProvider>
  );
  const isTaxed = (c: Call) =>
    c.path.endsWith("/quote") && Boolean((c.body as QuoteRequest).includeTax);
  const taxedQuotes = () => stub.calls.filter(isTaxed);
  const shippingCalls = () =>
    stub.calls.filter((c) => c.path.endsWith("/shipping-options"));
  return { ...stub, onCheckout, taxedQuotes, shippingCalls };
}

const type = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const totals = () => screen.getByRole("region", { name: "Order total" });

describe("<Checkout> taxed quotes", () => {
  it("typing an address sends one taxed quote, for the address as typed at the end", async () => {
    const { taxedQuotes, shippingCalls } = mount();
    fireEvent.click(await screen.findByLabelText(/Local delivery/));
    type("Street", "1 Main St");
    type("City", "Denver");
    // A slow typist: a pause after each key long enough for the options to
    // be asked again each time (the web app sent a taxed quote per pause).
    let typed = "";
    for (const ch of "80202") {
      typed += ch;
      type("Postal code", typed);
      await sleep(550);
    }
    expect(shippingCalls().length).toBeGreaterThanOrEqual(5);
    await waitFor(() => expect(taxedQuotes()).toHaveLength(1), {
      timeout: 3000,
    });
    await sleep(1200);
    expect(taxedQuotes()).toHaveLength(1);
    expect(taxedQuotes()[0]!.body).toEqual({
      lines: [{ listingId: "listing-1", priceId: "price-1", quantity: 2 }],
      shippingMethodId: "van",
      shippingAddress: {
        street1: "1 Main St",
        city: "Denver",
        postalCode: "80202",
      },
      includeTax: true,
    });
    await waitFor(() => expect(totals().textContent).toContain("$47.40"));
  }, 15_000);

  it("the checkout sends exactly the delivery the taxed quote priced", async () => {
    const { taxedQuotes, calls, onCheckout } = mount();
    fireEvent.click(await screen.findByLabelText(/Local delivery/));
    type("Street", "1 Main St");
    type("City", "Denver");
    type("Postal code", "80202");
    type(/^Country/, "us");
    await waitFor(() => expect(totals().textContent).toContain("$47.40"), {
      timeout: 4000,
    });
    type("Name", "Ada");
    type(/^Email/, "ada@example.com");
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to payment" })
    );
    await waitFor(() => expect(onCheckout).toHaveBeenCalled());
    const checkout = calls.find((c) => c.path.endsWith("/checkout"))!
      .body as Record<string, unknown>;
    const quoted = taxedQuotes().at(-1)!.body as Record<string, unknown>;
    expect(checkout.lines).toEqual(quoted.lines);
    expect(checkout.shippingMethodId).toBe(quoted.shippingMethodId);
    expect(checkout.shippingAddress).toEqual(quoted.shippingAddress);
    expect(quoted.shippingAddress).toMatchObject({ country: "US" });
  }, 10_000);

  it("going back to a delivery choice already quoted asks nothing new", async () => {
    const { taxedQuotes } = mount();
    fireEvent.click(await screen.findByLabelText(/Pick up at the shop/));
    await waitFor(() => expect(totals().textContent).toContain("$32.40"), {
      timeout: 3000,
    });
    fireEvent.click(screen.getByLabelText(/Local delivery/));
    type("Street", "1 Main St");
    type("City", "Denver");
    type("Postal code", "80202");
    await waitFor(() => expect(totals().textContent).toContain("$47.40"), {
      timeout: 4000,
    });
    expect(taxedQuotes()).toHaveLength(2);
    fireEvent.click(screen.getByLabelText(/Pick up at the shop/));
    await waitFor(() => expect(totals().textContent).toContain("$32.40"));
    fireEvent.click(screen.getByLabelText(/Local delivery/));
    await waitFor(() => expect(totals().textContent).toContain("$47.40"));
    await sleep(1500);
    expect(taxedQuotes()).toHaveLength(2);
  }, 12_000);

  it("a 429 keeps the last figures, marked as updating", async () => {
    const { taxedQuotes } = mount((b, n) =>
      n === 0
        ? taxedAnswer(b, n)
        : {
            status: 429,
            body: {
              error: "rate limit exceeded",
              message: "Too many requests. Please try again later.",
            },
          }
    );
    fireEvent.click(await screen.findByLabelText(/Pick up at the shop/));
    await waitFor(() => expect(totals().textContent).toContain("$32.40"), {
      timeout: 3000,
    });
    fireEvent.click(screen.getByLabelText(/Local delivery/));
    type("Street", "1 Main St");
    type("City", "Denver");
    type("Postal code", "80202");
    await waitFor(() => expect(totals().dataset.state).toBe("updating"), {
      timeout: 4000,
    });
    expect(totals().textContent).toContain("$32.40");
    expect(totals().textContent).toContain(
      "Updating the total in a few seconds"
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(taxedQuotes()).toHaveLength(2);
  }, 10_000);

  it("a store not taking orders online: said in the totals, and checkout is off", async () => {
    mount(() => ({
      status: 400,
      body: { error: "this store is not taking orders online" },
    }));
    fireEvent.click(await screen.findByLabelText(/Pick up at the shop/));
    await waitFor(
      () =>
        expect(totals().textContent).toBe(
          "This store isn't taking orders online right now."
        ),
      { timeout: 3000 }
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Continue to payment",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("nothing to pay for: said in the totals, and checkout is off", async () => {
    mount(() => ({
      status: 400,
      body: { error: "there is nothing to pay for in this order" },
    }));
    fireEvent.click(await screen.findByLabelText(/Pick up at the shop/));
    await waitFor(
      () => expect(totals().textContent).toMatch(/nothing to pay for/),
      {
        timeout: 3000,
      }
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Continue to payment",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });
});
