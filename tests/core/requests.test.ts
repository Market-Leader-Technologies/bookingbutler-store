import { describe, expect, it } from "vitest";
import {
  checkoutLines,
  checkoutRequest,
  quotedLines,
  quoteRequest,
  type Cart,
  type FormField,
} from "@bookingbutler/store";
import { bySizeLine, line } from "../helpers";

const form: FormField[] = [
  { fieldKey: "logo", type: "file", required: true },
  {
    fieldKey: "color",
    type: "single_select",
    choices: [{ key: "red", label: "Red" }],
  },
  { fieldKey: "notes", type: "string" },
];

const cart: Cart = {
  lines: [
    line({
      quantity: 2,
      form,
      answers: {
        logo: { uploadToken: "tok-1", fileName: "logo.png" },
        color: "Red",
        notes: "  ",
      },
    }),
    bySizeLine({ size: { width: 4, height: 8, unit: "ft" } }),
  ],
};

describe("quote request", () => {
  it("while shopping: goods only, no delivery, no includeTax, no answers", () => {
    expect(quoteRequest(cart)).toEqual({
      lines: [
        { listingId: "listing-1", priceId: "price-1", quantity: 2 },
        {
          listingId: "listing-sz",
          priceId: "price-sz",
          quantity: 1,
          size: { width: 4, height: 8, unit: "ft" },
        },
      ],
    });
  });

  it("at checkout: the delivery choice exactly as checkout sends it, and includeTax", () => {
    const body = quoteRequest(cart, {
      shipping: {
        methodId: "m-1",
        address: {
          street1: " 1 Main St ",
          city: "Denver",
          state: "",
          postalCode: "80202",
          country: "us",
        },
      },
      includeTax: true,
    });
    expect(body).toMatchObject({
      shippingMethodId: "m-1",
      shippingAddress: {
        street1: "1 Main St",
        city: "Denver",
        postalCode: "80202",
        country: "US",
      },
      includeTax: true,
    });
    expect(body!.shippingAddress).not.toHaveProperty("state");
  });

  it("a pickup sends its method and no address; includeTax only when asked", () => {
    const body = quoteRequest(cart, { shipping: { methodId: "pickup" } });
    expect(body).toMatchObject({ shippingMethodId: "pickup" });
    expect(body).not.toHaveProperty("shippingAddress");
    expect(body).not.toHaveProperty("includeTax");
    expect(quoteRequest(cart, { includeTax: true })).toMatchObject({
      includeTax: true,
    });
    expect(quoteRequest(cart, { includeTax: true })).not.toHaveProperty(
      "shippingMethodId"
    );
  });

  it("nothing for an empty cart or a by-size line without its size", () => {
    expect(quoteRequest({ lines: [] })).toBeUndefined();
    expect(quoteRequest({ lines: [line(), bySizeLine()] })).toBeUndefined();
  });
});

describe("checkout request", () => {
  it("sends ids, quantity, size and answers — never an amount", () => {
    const body = checkoutRequest(
      cart,
      { name: " Ada ", email: " ada@example.com ", phone: " ", note: "Thanks" },
      { methodId: "m-1", address: { postalCode: "80202" } }
    );
    expect(body).toEqual({
      lines: [
        {
          listingId: "listing-1",
          priceId: "price-1",
          quantity: 2,
          fields: { logo: "tok-1", color: "red" },
        },
        {
          listingId: "listing-sz",
          priceId: "price-sz",
          quantity: 1,
          size: { width: 4, height: 8, unit: "ft" },
        },
      ],
      name: "Ada",
      email: "ada@example.com",
      note: "Thanks",
      shippingMethodId: "m-1",
      shippingAddress: { postalCode: "80202" },
    });
    expect(JSON.stringify(body)).not.toMatch(/Cents|amount/i);
  });

  it("leaves fields out of a line without a form", () => {
    expect(checkoutLines({ lines: [line()] })[0]).toEqual({
      listingId: "listing-1",
      priceId: "price-1",
      quantity: 1,
    });
  });
});

describe("quoted lines", () => {
  it("gives a line no figures when it changed since the quote was asked", () => {
    const sent = checkoutLines(cart, { withAnswers: false });
    const quoted = sent.map((l) => ({ ...l, amountCents: 100 }));
    const changed: Cart = {
      lines: [{ ...cart.lines[0]!, quantity: 3 }, cart.lines[1]!],
    };
    const out = quotedLines(sent, quoted, changed.lines);
    expect(out[0]).toBeUndefined();
    expect(out[1]).toMatchObject({ amountCents: 100 });
    const resized = quotedLines(sent, quoted, [
      cart.lines[0]!,
      { ...cart.lines[1]!, size: { width: 5, height: 8, unit: "ft" } },
    ]);
    expect(resized[1]).toBeUndefined();
  });
});
