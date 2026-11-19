import { describe, expect, it } from "vitest";
import {
  classifyError,
  parseErrorKey,
  StoreApiError,
  uploadErrorMessage,
} from "@bookingbutler/store";

const err = (status: number, body?: unknown) =>
  new StoreApiError({ status, body });

describe("StoreApiError", () => {
  it("reads code, details and the line/field they name", () => {
    const e = err(400, {
      error: "validation failed",
      code: "FIELD_VALIDATION_ERROR",
      details: { "lines[2].fields.logo": "upload the file again" },
    });
    expect(e).toBeInstanceOf(Error);
    expect(e).toMatchObject({
      status: 400,
      code: "FIELD_VALIDATION_ERROR",
      key: "lines[2].fields.logo",
      field: "lines",
      lineIndex: 2,
      fieldKey: "logo",
      serverMessage: "validation failed",
    });
  });

  it("falls back to the sentence when there are no details", () => {
    const e = err(400, {
      error: "validation failed for field 'email': not an email",
    });
    expect(e.field).toBe("email");
  });
});

describe("parseErrorKey", () => {
  it.each([
    ["lines[0].size", { field: "lines", lineIndex: 0, size: true }],
    ["lines[3].size.unit", { field: "lines", lineIndex: 3, size: true }],
    ["lines[1].priceId", { field: "lines", lineIndex: 1 }],
    ["shippingAddress.city", { field: "address" }],
    ["shippingMethodId", { field: "shipping" }],
    ["email", { field: "email" }],
    ["mystery", {}],
  ])("%s", (key, expected) => expect(parseErrorKey(key)).toEqual(expected));
});

describe("classifyError", () => {
  it("429, 503, 404 and no answer", () => {
    expect(classifyError(err(429)).kind).toBe("rateLimited");
    expect(classifyError(err(503)).kind).toBe("tax");
    expect(classifyError(err(404)).kind).toBe("missing");
    expect(classifyError(err(0)).kind).toBe("network");
    expect(classifyError(new Error("boom"))).toEqual({
      kind: "other",
      message: "boom",
    });
  });

  it("STORE_CLOSED", () => {
    expect(
      classifyError(err(400, { code: "STORE_CLOSED", error: "closed" })).kind
    ).toBe("closed");
  });

  it("DELIVERY_METHOD_UNAVAILABLE asks for the options again, on the delivery field", () => {
    const f = classifyError(
      err(400, {
        code: "DELIVERY_METHOD_UNAVAILABLE",
        error: "that delivery method is not available for this order",
        details: {
          shippingMethodId:
            "not available for this order: ask for the options again",
        },
      })
    );
    expect(f).toMatchObject({
      kind: "invalid",
      field: "shipping",
      refetchShipping: true,
    });
    expect(f.message).toMatch(/^Delivery: /);
  });

  it("DELIVERY_METHOD_REQUIRED is on the field but needs no refetch", () => {
    const f = classifyError(
      err(400, {
        code: "DELIVERY_METHOD_REQUIRED",
        error: "choose how the order gets to you",
      })
    );
    expect(f).toMatchObject({ kind: "invalid", field: "shipping" });
    expect(f).not.toHaveProperty("refetchShipping");
  });

  it("maps lines[i].size and lines[i].fields.<key> to their line", () => {
    const f = classifyError(
      err(400, {
        error: "validation failed",
        details: {
          "lines[1].size": "a width and a height are needed",
          "lines[0].fields.logo": "upload the file again",
        },
      }),
      { lineNames: ["Shirt", "Banner (Size: 3x6)"] }
    );
    expect(f).toMatchObject({
      kind: "invalid",
      lineIndex: 1,
      lineSizes: { 1: "A width and a height are needed" },
      lineFields: { 0: { logo: "Upload the file again" } },
    });
    expect(f.message).toBe(
      "Banner (Size: 3x6): a width and a height are needed"
    );
  });

  it("not taking orders online", () => {
    expect(
      classifyError(
        err(400, { error: "this store is not taking orders online" })
      ).kind
    ).toBe("notTaking");
  });
});

describe("uploadErrorMessage", () => {
  it("words each refusal", () => {
    expect(uploadErrorMessage(err(413))).toMatch(/too big/);
    expect(uploadErrorMessage(err(429))).toMatch(/Too many uploads/);
    expect(
      uploadErrorMessage(err(400, { error: "that file type is blocked" }))
    ).toBe("That file type is blocked");
    expect(uploadErrorMessage(err(500))).toMatch(/didn't upload/);
  });
});

describe("classifyError: the taxed quote's refusals (TODO 10)", () => {
  it("DELIVERY_METHOD_REQUIRED asks for a delivery choice, on the shipping field", () => {
    const f = classifyError(
      err(400, {
        error: "validation failed",
        code: "DELIVERY_METHOD_REQUIRED",
        details: { shippingMethodId: "choose how the order gets to you" },
      })
    );
    expect(f).toMatchObject({
      kind: "invalid",
      field: "shipping",
      needsShipping: true,
      code: "DELIVERY_METHOD_REQUIRED",
      message: "Delivery: choose how the order gets to you",
    });
    expect(f).not.toHaveProperty("refetchShipping");
  });

  it("a store not taking orders online", () => {
    expect(
      classifyError(
        err(400, { error: "this store is not taking orders online" })
      )
    ).toEqual({
      kind: "notTaking",
      message: "This store isn't taking orders online right now.",
    });
  });

  it("a cart with nothing to pay for", () => {
    expect(
      classifyError(
        err(400, { error: "there is nothing to pay for in this order" })
      ).kind
    ).toBe("nothingToPay");
  });

  it("a 429 says to try again in a moment", () => {
    expect(classifyError(err(429, { error: "rate limit exceeded" }))).toEqual({
      kind: "rateLimited",
      message: "Too many requests just now. Try again in a moment.",
    });
    expect(uploadErrorMessage(err(429))).toBe(
      "Too many uploads just now. Try again in a moment."
    );
  });
});
