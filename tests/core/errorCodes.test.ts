import { describe, expect, it } from "vitest";
import {
  ADDRESS_REQUIRED,
  classifyError,
  classifyReceiptError,
  createStoreClient,
  DELIVERY_METHOD_REQUIRED,
  DELIVERY_METHOD_UNAVAILABLE,
  NOTHING_TO_PAY,
  ORDER_NOT_PLACED,
  STORE_CLOSED,
  STORE_ERROR_CODES,
  STORE_HAS_NO_DELIVERY,
  STORE_NOT_TAKING_ORDERS,
  type RateLimitedBody,
  type ReceiptConflictBody,
  type ValidationErrorBody,
} from "@bookingbutler/store";
import { BASE, STORE, stubFetch } from "../helpers";

/** What the store's quote route answers with `body`, through the real client. */
async function refusedQuote(status: number, body: unknown) {
  const { fetch } = stubFetch({
    "POST /public/stores/{id}/quote": () => ({ status, body }),
  });
  const client = createStoreClient({ storeId: STORE, baseUrl: BASE, fetch });
  try {
    await client.quote({
      lines: [{ listingId: "l", priceId: "p", quantity: 1 }],
      shippingMethodId: "van",
      includeTax: true,
    });
  } catch (err) {
    return err;
  }
  throw new Error("the quote was not refused");
}

const refusal = (
  code: ValidationErrorBody["code"],
  error: string,
  details?: Record<string, string>
): ValidationErrorBody => ({ error, code, ...(details ? { details } : {}) });

describe("error codes", () => {
  it("exports every code a store client can switch on", () => {
    expect(STORE_ERROR_CODES).toEqual([
      "STORE_CLOSED",
      "STORE_NOT_TAKING_ORDERS",
      "NOTHING_TO_PAY",
      "DELIVERY_METHOD_REQUIRED",
      "DELIVERY_METHOD_UNAVAILABLE",
      "ADDRESS_REQUIRED",
      "STORE_HAS_NO_DELIVERY",
      "ORDER_NOT_PLACED",
    ]);
  });
});

describe("classifyError: by code (stubbed fetch)", () => {
  it("STORE_CLOSED", async () => {
    const f = classifyError(
      await refusedQuote(400, refusal(STORE_CLOSED, "this store has closed"))
    );
    expect(f.kind).toBe("closed");
  });

  it("STORE_NOT_TAKING_ORDERS, whatever the sentence", async () => {
    const f = classifyError(
      await refusedQuote(400, refusal(STORE_NOT_TAKING_ORDERS, "reworded"))
    );
    expect(f).toEqual({
      kind: "notTaking",
      message: "This store isn't taking orders online right now.",
    });
  });

  it("NOTHING_TO_PAY, whatever the sentence", async () => {
    const f = classifyError(
      await refusedQuote(400, refusal(NOTHING_TO_PAY, "reworded"))
    );
    expect(f.kind).toBe("nothingToPay");
  });

  it("DELIVERY_METHOD_REQUIRED: on the choice, no refetch", async () => {
    const f = classifyError(
      await refusedQuote(
        400,
        refusal(DELIVERY_METHOD_REQUIRED, "choose how the order gets to you", {
          shippingMethodId: "choose how the order gets to you",
        })
      )
    );
    expect(f).toMatchObject({
      kind: "invalid",
      field: "shipping",
      needsShipping: true,
      code: DELIVERY_METHOD_REQUIRED,
    });
    expect(f).not.toHaveProperty("refetchShipping");
    expect(f).not.toHaveProperty("needsAddress");
  });

  it("DELIVERY_METHOD_UNAVAILABLE: on the choice, ask for the options again", async () => {
    const f = classifyError(
      await refusedQuote(
        400,
        refusal(DELIVERY_METHOD_UNAVAILABLE, "reworded", {
          shippingMethodId: "not available for this order",
        })
      )
    );
    expect(f).toMatchObject({
      kind: "invalid",
      field: "shipping",
      refetchShipping: true,
      code: DELIVERY_METHOD_UNAVAILABLE,
    });
    expect(f).not.toHaveProperty("needsAddress");
  });

  it("STORE_HAS_NO_DELIVERY: on the choice, ask for the options again", async () => {
    const f = classifyError(
      await refusedQuote(400, refusal(STORE_HAS_NO_DELIVERY, "reworded"))
    );
    expect(f).toMatchObject({
      kind: "invalid",
      field: "shipping",
      refetchShipping: true,
    });
  });

  it("ADDRESS_REQUIRED: on the address, keeps the delivery choice", async () => {
    const f = classifyError(
      await refusedQuote(
        400,
        refusal(
          ADDRESS_REQUIRED,
          "validation failed for field 'shippingAddress': this delivery method needs the address the order goes to",
          {
            shippingAddress:
              "this delivery method needs the address the order goes to",
          }
        )
      )
    );
    expect(f).toEqual({
      kind: "invalid",
      field: "address",
      needsAddress: true,
      code: ADDRESS_REQUIRED,
      message:
        "Delivery address: this delivery method needs the address the order goes to",
    });
  });

  it("ADDRESS_REQUIRED without details still lands on the address", async () => {
    const f = classifyError(
      await refusedQuote(400, refusal(ADDRESS_REQUIRED, "needs an address"))
    );
    expect(f).toMatchObject({
      kind: "invalid",
      field: "address",
      needsAddress: true,
    });
    expect(f).not.toHaveProperty("refetchShipping");
  });

  it("a code wins over a sentence that says something else", async () => {
    const f = classifyError(
      await refusedQuote(
        400,
        refusal(
          DELIVERY_METHOD_REQUIRED,
          "this store is not taking orders online"
        )
      )
    );
    expect(f.kind).toBe("invalid");
  });

  it("an older server without codes: the sentences still classify", async () => {
    expect(
      classifyError(
        await refusedQuote(400, {
          error: "this store is not taking orders online",
        })
      ).kind
    ).toBe("notTaking");
    expect(
      classifyError(
        await refusedQuote(400, {
          error: "there is nothing to pay for in this order",
        })
      ).kind
    ).toBe("nothingToPay");
  });

  it("429 body is the generated RateLimitedBody", async () => {
    const body: RateLimitedBody = {
      error: "rate limit exceeded",
      message: "Too many requests. Please try again later.",
    };
    const err = await refusedQuote(429, body);
    expect(err).toMatchObject({
      status: 429,
      body,
      serverMessage: "Too many requests. Please try again later.",
    });
    expect(classifyError(err).kind).toBe("rateLimited");
  });
});

describe("classifyReceiptError: ORDER_NOT_PLACED (stubbed fetch)", () => {
  it("the 409 body is the generated ReceiptConflictBody", async () => {
    const body: ReceiptConflictBody = {
      error: "the order has not been placed",
      code: ORDER_NOT_PLACED,
    };
    const { fetch } = stubFetch({
      "GET /public/orders/{token}/receipt": () => ({ status: 409, body }),
    });
    const client = createStoreClient({ storeId: STORE, baseUrl: BASE, fetch });
    const err = await client.downloadReceipt("tok").catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 409, code: ORDER_NOT_PLACED, body });
    expect(classifyReceiptError(err).kind).toBe("notPlaced");
  });
});
