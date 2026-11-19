import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyReceiptError,
  createStoreClient,
  receiptAvailable,
  receiptFileName,
  saveReceipt,
  StoreApiError,
} from "@bookingbutler/store";
import { BASE, STORE, stubFetch } from "../helpers";

const pdf = (headers: Record<string, string> = {}) =>
  new Response("%PDF-1.7 fake", {
    status: 200,
    headers: { "Content-Type": "application/pdf", ...headers },
  });

const clientWith = (
  reply: () => Response | { status: number; body: unknown }
) => {
  const stub = stubFetch({ "GET /public/orders/{t}/receipt": reply });
  return {
    ...stub,
    client: createStoreClient({
      storeId: STORE,
      baseUrl: BASE,
      fetch: stub.fetch,
    }),
  };
};

const refusal = async (status: number, body: unknown) => {
  const { client } = clientWith(() => ({ status, body }));
  return client.downloadReceipt("tok").catch((e: unknown) => e);
};

afterEach(() => vi.useRealTimers());

describe("receiptFileName", () => {
  it("reads the server's name, plain, quoted or RFC 5987", () => {
    expect(receiptFileName("attachment; filename=Receipt-1042.pdf")).toBe(
      "Receipt-1042.pdf"
    );
    expect(receiptFileName('attachment; filename="Receipt 7.pdf"')).toBe(
      "Receipt 7.pdf"
    );
    expect(
      receiptFileName("attachment; filename*=utf-8''Re%C3%A7u-12.pdf")
    ).toBe("Reçu-12.pdf");
  });

  it("falls back to the order number, then Receipt.pdf", () => {
    expect(receiptFileName(null, "1042")).toBe("Receipt-1042.pdf");
    expect(receiptFileName("attachment", undefined)).toBe("Receipt.pdf");
    expect(receiptFileName("", "  ")).toBe("Receipt.pdf");
  });

  it("never lets a name carry a path", () => {
    expect(receiptFileName("attachment; filename=../../etc/passwd")).toBe(
      "etc-passwd"
    );
    expect(receiptFileName(null, "A/B")).toBe("Receipt-A-B.pdf");
  });
});

describe("client.downloadReceipt", () => {
  it("GETs the receipt route, asking for a PDF, and names the file from Content-Disposition", async () => {
    const { client, calls } = clientWith(() =>
      pdf({ "Content-Disposition": "attachment; filename=Receipt-1042.pdf" })
    );
    const receipt = await client.downloadReceipt("t/ok", {
      orderNumber: "999",
    });
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/public/orders/t%2Fok/receipt`);
    expect(calls[0]!.headers.accept).toBe("application/pdf, application/json");
    expect(receipt.filename).toBe("Receipt-1042.pdf");
    expect(receipt.blob.type).toBe("application/pdf");
    expect(await receipt.blob.text()).toBe("%PDF-1.7 fake");
  });

  it("falls back to Receipt-<orderNumber>.pdf when the header can't be read", async () => {
    const { client } = clientWith(() => pdf());
    expect(
      (await client.downloadReceipt("t", { orderNumber: "77" })).filename
    ).toBe("Receipt-77.pdf");
    expect((await client.downloadReceipt("t")).filename).toBe("Receipt.pdf");
  });

  it("throws a StoreApiError carrying the JSON {error, code}", async () => {
    const err = await refusal(409, {
      error: "this order has not been placed",
      code: "ORDER_NOT_PLACED",
    });
    expect(err).toBeInstanceOf(StoreApiError);
    expect((err as StoreApiError).status).toBe(409);
    expect((err as StoreApiError).code).toBe("ORDER_NOT_PLACED");
  });
});

describe("classifyReceiptError", () => {
  it("maps each refusal to what to say", async () => {
    expect(
      classifyReceiptError(await refusal(404, { error: "not found" }))
    ).toEqual({
      kind: "missing",
      message: "Receipt not found.",
    });
    expect(
      classifyReceiptError(
        await refusal(409, { error: "x", code: "ORDER_NOT_PLACED" })
      ).kind
    ).toBe("notPlaced");
    expect(
      classifyReceiptError(
        await refusal(429, {
          error: "rate limit exceeded",
          message: "Too many requests. Please try again later.",
        })
      )
    ).toEqual({ kind: "rateLimited", message: "Try again in a moment." });
    expect(
      classifyReceiptError(await refusal(503, { error: "renderer down" }))
    ).toEqual({
      kind: "unavailable",
      message: "The receipt couldn't be made just now. Try again in a moment.",
    });
    expect(classifyReceiptError(await refusal(500, {})).kind).toBe("other");
    expect(classifyReceiptError(new StoreApiError({ status: 0 })).kind).toBe(
      "network"
    );
  });
});

describe("receiptAvailable", () => {
  it("only once the order is placed", () => {
    expect(receiptAvailable(undefined)).toBe(false);
    expect(receiptAvailable({})).toBe(false);
    expect(receiptAvailable({ paymentStatus: "pending" })).toBe(false);
    for (const s of ["unpaid", "deposit_paid", "paid"] as const)
      expect(receiptAvailable({ paymentStatus: s })).toBe(true);
  });
});

describe("saveReceipt", () => {
  it("clicks a download link named for the file, then revokes the URL", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:receipt");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const clicked: HTMLAnchorElement[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this);
      });
    const blob = new Blob(["x"], { type: "application/pdf" });
    saveReceipt({ blob, filename: "Receipt-1.pdf" });
    expect(create).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledTimes(1);
    expect(clicked[0]!.download).toBe("Receipt-1.pdf");
    expect(clicked[0]!.href).toBe("blob:receipt");
    expect(document.querySelector("a[download]")).toBeNull();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:receipt");
  });
});
