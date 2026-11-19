import { HTTP, isStoreApiError, ORDER_NOT_PLACED } from "./errors";
import type { Order } from "./types";

/*
 * Order receipts: `GET /public/orders/{token}/receipt` answers a PDF made as
 * the order stands now. These helpers name the file, save it in a browser,
 * and say what a refusal means.
 */

/**
 * The order has a receipt: it was placed (`paymentStatus` is anything but
 * `pending`). An order placed with nothing charged has one too, and so does
 * a canceled order. Before that the route answers 409 `ORDER_NOT_PLACED`.
 */
export const receiptAvailable = (
  order: Pick<Order, "paymentStatus"> | null | undefined
): boolean => order?.paymentStatus != null && order.paymentStatus !== "pending";

/** A file name with no path in it and nothing a file system refuses. */
const safeName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/^[.\s-]+/, "")
    .trim();

/**
 * The name to save a receipt under: the server's, from `Content-Disposition`
 * (`attachment; filename=Receipt-1042.pdf`, quoted, or RFC 5987
 * `filename*=UTF-8''…`), else `Receipt-<orderNumber>.pdf`, else `Receipt.pdf`.
 */
export function receiptFileName(
  contentDisposition: string | null | undefined,
  orderNumber?: string | null
): string {
  const header = contentDisposition ?? "";
  let name = "";
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (extended) {
    try {
      name = decodeURIComponent(extended[2]!.trim().replace(/^"|"$/g, ""));
    } catch {
      name = "";
    }
  }
  if (!name) {
    const plain =
      /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header) ??
      /filename\s*=\s*([^;]+)/i.exec(header);
    if (plain) name = plain[1]!.replace(/\\(.)/g, "$1").trim();
  }
  name = safeName(name);
  if (name) return name;
  const number = safeName(orderNumber?.trim() ?? "");
  return number ? `Receipt-${number}.pdf` : "Receipt.pdf";
}

/**
 * Saves a downloaded receipt in the browser (a download named `filename`).
 * Browser-only: it needs `document` and `URL.createObjectURL`.
 */
export function saveReceipt({
  blob,
  filename,
}: {
  blob: Blob;
  filename: string;
}): void {
  if (typeof document === "undefined" || typeof URL === "undefined")
    throw new Error("saveReceipt: only works in a browser");
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    // Revoked later: some browsers start the download after click returns.
    setTimeout(() => URL.revokeObjectURL(href), 30_000);
  }
}

/** What a refused receipt download means. */
export type ReceiptFailure =
  /** 404: unknown token, or not this shop's order. */
  | { kind: "missing"; message: string }
  /** 409 `ORDER_NOT_PLACED`: the checkout was never completed. */
  | { kind: "notPlaced"; message: string }
  /** 429: receipts have their own limit (10 in a burst, then 1 per 10 s). */
  | { kind: "rateLimited"; message: string }
  /** 503: the PDF renderer is out of reach or busy. */
  | { kind: "unavailable"; message: string }
  /** No answer at all: offline, DNS, CORS. */
  | { kind: "network"; message: string }
  | { kind: "other"; message: string };

/** What to say when a receipt download fails. */
export function classifyReceiptError(error: unknown): ReceiptFailure {
  const status = isStoreApiError(error) ? error.status : undefined;
  if (status === 0)
    return {
      kind: "network",
      message:
        "We couldn't reach the store. Check your connection and try again.",
    };
  if (status === HTTP.NOT_FOUND)
    return { kind: "missing", message: "Receipt not found." };
  if (
    status === HTTP.CONFLICT &&
    isStoreApiError(error) &&
    error.code === ORDER_NOT_PLACED
  )
    return {
      kind: "notPlaced",
      message: "This order hasn't been placed yet, so it has no receipt.",
    };
  if (status === HTTP.TOO_MANY_REQUESTS)
    return { kind: "rateLimited", message: "Try again in a moment." };
  if (status === HTTP.SERVICE_UNAVAILABLE)
    return {
      kind: "unavailable",
      message: "The receipt couldn't be made just now. Try again in a moment.",
    };
  return {
    kind: "other",
    message: "The receipt didn't download. Try again.",
  };
}
