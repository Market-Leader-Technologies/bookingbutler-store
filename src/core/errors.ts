import type { ValidationErrorCode } from "./types";

/** HTTP statuses the store API answers with, by name. */
export const HTTP = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  SERVICE_UNAVAILABLE: 503,
} as const;

/** The checkout form's fields a refusal can name. */
export type CheckoutField =
  | "name"
  | "email"
  | "phone"
  | "note"
  | "lines"
  /** How the order gets there: `shippingMethodId`. */
  | "shipping"
  /** Where it goes: `shippingAddress` and its parts. */
  | "address";

/** Line index → field key → what is wrong with that answer. */
export type LineFieldErrors = Record<number, Record<string, string>>;
/** Line index → what is wrong with that line's size. */
export type LineSizeErrors = Record<number, string>;

/** Where a validation key points: `email`, `lines[2].fields.logo`, `lines[0].size.unit`. */
export interface ErrorTarget {
  field?: CheckoutField;
  lineIndex?: number;
  /** The answer a `lines[i].fields.<key>` refusal names. */
  fieldKey?: string;
  /** `lines[i].size` or any part of it. */
  size?: boolean;
}

const KEY_FIELDS: Record<string, CheckoutField> = {
  shippingMethodId: "shipping",
  shippingAddress: "address",
};
const PLAIN_FIELDS = new Set(["name", "email", "phone", "note"]);

/** The field a validation key names. A line's index is the request's, which is the cart's. */
export function parseErrorKey(key: string): ErrorTarget {
  const line = /^lines\[(\d+)\](?:\.fields\.(.+)|\.(size)(?:[.[].*)?$)?/.exec(
    key
  );
  if (line)
    return {
      field: "lines",
      lineIndex: Number(line[1]),
      ...(line[2] ? { fieldKey: line[2] } : {}),
      ...(line[3] ? { size: true } : {}),
    };
  if (key === "lines") return { field: "lines" };
  const head = key.split(/[.[]/)[0]!;
  if (head in KEY_FIELDS) return { field: KEY_FIELDS[head] };
  if (PLAIN_FIELDS.has(key)) return { field: key as CheckoutField };
  return {};
}

/**
 * Any non-2xx answer from the store API, or a request that never got one
 * (`status: 0`, a network failure or CORS refusal). Aborted requests are not
 * wrapped: they reject with the platform's `AbortError` (see `isAbortError`).
 */
export class StoreApiError extends Error {
  override readonly name = "StoreApiError";
  /** HTTP status; 0 when the request never got an answer. */
  readonly status: number;
  /** The server's machine-readable code, e.g. `STORE_CLOSED`. */
  readonly code?: ValidationErrorCode | (string & {});
  /** `details`: request key → what is wrong with it. */
  readonly details: Record<string, string>;
  /** The request key the refusal names first (`lines[0].size`, `email`). */
  readonly key?: string;
  /** The form field that key belongs to. */
  readonly field?: CheckoutField;
  /** The cart line it names, by index. */
  readonly lineIndex?: number;
  /** The answer it names (`lines[i].fields.<fieldKey>`). */
  readonly fieldKey?: string;
  /** The parsed JSON body, or the text when it wasn't JSON. */
  readonly body: unknown;
  /** The server's own sentence (`error`/`message`), before any rewording. */
  readonly serverMessage: string;
  readonly method?: string;
  readonly url?: string;

  constructor(init: {
    status: number;
    body?: unknown;
    message?: string;
    method?: string;
    url?: string;
    cause?: unknown;
  }) {
    const body = init.body;
    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const text = (v: unknown) =>
      typeof v === "string" && v.trim() !== "" ? v : "";
    const errorText = text(record.error);
    const messageText = text(record.message);
    // `{error: "some_code", message: "A sentence"}` (and a 429's
    // `{error: "rate limit exceeded", message: "Too many requests…"}`): the
    // code is for machines, the message for people. Otherwise `error` is
    // the sentence.
    const serverMessage =
      errorText &&
      (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(errorText) ||
        /^rate limit exceeded$/i.test(errorText)) &&
      messageText
        ? messageText
        : errorText ||
          messageText ||
          (typeof body === "string" ? body.slice(0, 300) : "");
    super(
      init.message ??
        (serverMessage ||
          (init.status
            ? `Request failed with status ${init.status}`
            : "Network request failed")),
      init.cause !== undefined ? { cause: init.cause } : undefined
    );
    this.status = init.status;
    this.body = body;
    this.serverMessage = serverMessage;
    this.method = init.method;
    this.url = init.url;
    this.code =
      typeof record.code === "string" ? (record.code as string) : undefined;
    const details: Record<string, string> = {};
    if (record.details && typeof record.details === "object")
      for (const [k, v] of Object.entries(record.details))
        if (typeof v === "string") details[k] = v;
    this.details = details;
    const fallback = /field '([^']+)':/.exec(serverMessage);
    this.key = Object.keys(details)[0] ?? fallback?.[1];
    const target = this.key ? parseErrorKey(this.key) : {};
    this.field = target.field;
    this.lineIndex = target.lineIndex;
    this.fieldKey = target.fieldKey;
  }
}

export const isStoreApiError = (error: unknown): error is StoreApiError =>
  error instanceof StoreApiError ||
  (Boolean(error) &&
    typeof error === "object" &&
    (error as { name?: unknown }).name === "StoreApiError" &&
    typeof (error as { status?: unknown }).status === "number");

/** A request cancelled by its AbortSignal (a newer quote replaced it). */
export const isAbortError = (error: unknown): boolean =>
  Boolean(error) &&
  typeof error === "object" &&
  (error as { name?: unknown }).name === "AbortError";

const statusOf = (error: unknown) =>
  isStoreApiError(error) ? error.status : undefined;

// ─── Classification ──────────────────────────────────────────────────────────

/** What a refused quote or checkout means, and where to say it. */
export type StoreFailure =
  /** 400 naming what to fix: a field, or one line of the cart. */
  | {
      kind: "invalid";
      message: string;
      field?: CheckoutField;
      lineIndex?: number;
      fieldKey?: string;
      /** Every answer the refusal names, for showing each on its field. */
      lineFields?: LineFieldErrors;
      /** Every line size the refusal names, for its size input. */
      lineSizes?: LineSizeErrors;
      /**
       * The delivery method is gone or out of reach since the options were
       * read (`DELIVERY_METHOD_UNAVAILABLE`, `STORE_HAS_NO_DELIVERY`): ask
       * for the shipping options again.
       */
      refetchShipping?: boolean;
      /**
       * `DELIVERY_METHOD_REQUIRED`: a taxed quote (or checkout) without a
       * delivery choice at a store that delivers. Ask for tax only once a
       * method is chosen; quote without `includeTax` before then.
       */
      needsShipping?: boolean;
      code?: string;
    }
  /**
   * 400 "not taking orders online": the shop can't take payment. A taxed
   * quote and the checkout are refused; a quote without `includeTax` still
   * prices the cart, so the cart can show it.
   */
  | { kind: "notTaking"; message: string }
  /** 400 "nothing to pay for": a taxed quote or checkout of a cart that comes to nothing. */
  | { kind: "nothingToPay"; message: string }
  /** 400 `STORE_CLOSED`: a temporary store past its closing time. */
  | { kind: "closed"; message: string }
  /** 503: tax couldn't be worked out just now. The checkout tries again. */
  | { kind: "tax"; message: string }
  /**
   * 429: too many requests from this address just now. The API sends no
   * `Retry-After`; wait a few seconds. The quoters retry by themselves.
   */
  | { kind: "rateLimited"; message: string }
  /** 404: the store, or a listing in the cart, isn't shown any more. */
  | { kind: "missing"; message: string }
  /** No answer at all: offline, DNS, CORS. */
  | { kind: "network"; message: string }
  | { kind: "other"; message: string };

const FIELD_LABELS: Record<Exclude<CheckoutField, "lines">, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  note: "Note",
  shipping: "Delivery",
  address: "Delivery address",
};

const STALE_SHIPPING_CODES = new Set([
  "DELIVERY_METHOD_UNAVAILABLE",
  "STORE_HAS_NO_DELIVERY",
]);
const SHIPPING_FIELD_CODES = new Set([
  "DELIVERY_METHOD_REQUIRED",
  "DELIVERY_METHOD_UNAVAILABLE",
  "STORE_HAS_NO_DELIVERY",
]);
const ADDRESS_INCOMPLETE = /delivery address needs/i;
/** The same refusals by their sentence, for an answer without a `code`. */
const SHIPPING_GONE_TEXT =
  /ask for the options again|not available for this order|this store has no delivery methods|this store does not deliver/i;
const NO_SHIPPING_CHOICE_TEXT = /choose how the order gets to you/i;
const NOT_TAKING_TEXT = /not taking orders online/i;
const NOTHING_TO_PAY_TEXT = /nothing to pay for/i;

/** What a 429 from any public route says. */
export const RATE_LIMITED_MESSAGE =
  "Too many requests just now. Try again in a moment.";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function lineFieldErrors(
  details: Record<string, string>
): LineFieldErrors | undefined {
  const out: LineFieldErrors = {};
  for (const [key, detail] of Object.entries(details)) {
    const { lineIndex, fieldKey } = parseErrorKey(key);
    if (lineIndex == null || !fieldKey) continue;
    out[lineIndex] = {
      ...out[lineIndex],
      [fieldKey]: capitalize(detail || "check this and try again."),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function lineSizeErrors(
  details: Record<string, string>
): LineSizeErrors | undefined {
  const out: LineSizeErrors = {};
  for (const [key, detail] of Object.entries(details)) {
    const { lineIndex, size } = parseErrorKey(key);
    if (lineIndex == null || !size || out[lineIndex]) continue;
    out[lineIndex] = capitalize(detail || "check the size and try again.");
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * What a refused quote or checkout says, and where. `lineNames` are how a
 * message names cart lines ("Banner (Size: 3x6): …"). The 400's
 * `details: {key: message}` place the refusal; its sentence
 * `validation failed for field 'x': …` is the fallback without them.
 */
export function classifyError(
  error: unknown,
  { lineNames = [] }: { lineNames?: string[] } = {}
): StoreFailure {
  const status = statusOf(error);
  if (status === 0)
    return {
      kind: "network",
      message:
        "We couldn't reach the store. Check your connection and try again.",
    };
  if (status === HTTP.TOO_MANY_REQUESTS)
    return {
      kind: "rateLimited",
      message: RATE_LIMITED_MESSAGE,
    };
  if (status === HTTP.SERVICE_UNAVAILABLE)
    return {
      kind: "tax",
      message:
        "We couldn't work out the tax on this order just now. Try again in a moment.",
    };
  if (status === HTTP.NOT_FOUND)
    return {
      kind: "missing",
      message:
        "This store, or something in your cart, isn't available any more. Check your cart and try again.",
    };
  if (status === HTTP.BAD_REQUEST && isStoreApiError(error)) {
    const message = error.serverMessage;
    const code = error.code;
    if (code === "STORE_CLOSED")
      return {
        kind: "closed",
        message: "This store has closed and isn't taking orders any more.",
      };
    if (NOT_TAKING_TEXT.test(message))
      return {
        kind: "notTaking",
        message: "This store isn't taking orders online right now.",
      };
    if (NOTHING_TO_PAY_TEXT.test(message))
      return {
        kind: "nothingToPay",
        message:
          "There's nothing to pay for in this order. Add something to your cart first.",
      };
    const details = error.details;
    const [key, detail] = Object.entries(details)[0] ?? [];
    const fallback = /field '([^']+)':\s*(.*)$/.exec(message);
    const requestKey = key ?? fallback?.[1];
    const text = detail ?? fallback?.[2] ?? message;
    const parsed = requestKey ? parseErrorKey(requestKey) : {};
    const { lineIndex, fieldKey } = parsed;
    const shippingGone =
      code != null
        ? STALE_SHIPPING_CODES.has(code)
        : SHIPPING_GONE_TEXT.test(message);
    const field =
      parsed.field ??
      ((
        code != null
          ? SHIPPING_FIELD_CODES.has(code)
          : SHIPPING_GONE_TEXT.test(message) ||
            NO_SHIPPING_CHOICE_TEXT.test(message)
      )
        ? "shipping"
        : ADDRESS_INCOMPLETE.test(message)
          ? "address"
          : undefined);
    const named = key
      ? details
      : requestKey && text
        ? { [requestKey]: text }
        : {};
    const needsShipping =
      code != null
        ? code === "DELIVERY_METHOD_REQUIRED"
        : NO_SHIPPING_CHOICE_TEXT.test(message);
    const lineFields = lineFieldErrors(named);
    const lineSizes = lineSizeErrors(named);
    const where =
      lineIndex != null
        ? (lineNames[lineIndex] ?? `Item ${lineIndex + 1}`)
        : field && field !== "lines"
          ? FIELD_LABELS[field]
          : undefined;
    return {
      kind: "invalid",
      ...(field ? { field } : {}),
      ...(lineIndex != null ? { lineIndex } : {}),
      ...(fieldKey ? { fieldKey } : {}),
      ...(lineFields ? { lineFields } : {}),
      ...(lineSizes ? { lineSizes } : {}),
      ...(shippingGone ? { refetchShipping: true } : {}),
      ...(needsShipping ? { needsShipping: true } : {}),
      ...(code ? { code } : {}),
      message: where
        ? `${where}: ${text || "check this and try again."}`
        : capitalize(text || "Check your cart and details, then try again."),
    };
  }
  const fallbackMessage = isStoreApiError(error)
    ? error.serverMessage
    : error instanceof Error
      ? error.message
      : "";
  return {
    kind: "other",
    message: fallbackMessage || "Something went wrong. Try again.",
  };
}

/** What a refused upload says: the server's reason for a 400, plain words otherwise. */
export function uploadErrorMessage(error: unknown): string {
  const status = statusOf(error);
  if (status === HTTP.TOO_MANY_REQUESTS)
    return "Too many uploads just now. Try again in a moment.";
  if (status === HTTP.PAYLOAD_TOO_LARGE)
    return "That file is too big. Files can be up to 50 MB.";
  if (status === HTTP.BAD_REQUEST && isStoreApiError(error))
    return capitalize(
      error.serverMessage ||
        "That file can't be used. Try a PNG, JPEG, PDF or another print file."
    );
  return "The file didn't upload. Try again.";
}
