import { isAbortError, StoreApiError } from "./errors";
import { receiptFileName } from "./receipt";
import type {
  CheckoutRequest,
  ListListingsParams,
  Listing,
  ListingPage,
  Order,
  Quote,
  QuoteRequest,
  ShippingOptions,
  ShippingOptionsRequest,
  Store,
  Upload,
} from "./types";

export interface StoreClientOptions {
  /** The public store's id (a UUID), from the store's settings. */
  storeId: string;
  /**
   * The API's origin. Defaults to production, {@link DEFAULT_BASE_URL}; pass
   * another (a dev or staging API) to point elsewhere. A trailing slash or a
   * trailing `/api/v1` is accepted and normalized.
   */
  baseUrl?: string;
  /** A fetch to use instead of the global one (tests, Next.js caching options). */
  fetch?: typeof fetch;
  /** Extra headers on every request. The public API needs no auth: never send a token. */
  headers?: Record<string, string>;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Passed to fetch as is, e.g. `{ next: { revalidate: 60 } }` in Next.js. */
  init?: RequestInit & Record<string, unknown>;
}

export interface StoreClient {
  readonly storeId: string;
  readonly baseUrl: string;
  /** `GET /public/stores/{storeId}`: name, description, categories, tags, closed. */
  getStore(options?: RequestOptions): Promise<Store>;
  /** `GET /public/stores/{storeId}/listings`: one page, searched and filtered. */
  listListings(
    params?: ListListingsParams,
    options?: RequestOptions
  ): Promise<ListingPage>;
  /** `GET /public/stores/{storeId}/listings/{listingId}`: options, prices, form. */
  getListing(listingId: string, options?: RequestOptions): Promise<Listing>;
  /** `POST /public/stores/{storeId}/uploads`: a file for a line's file field. */
  uploadFile(
    file: Blob,
    options?: RequestOptions & { fileName?: string }
  ): Promise<Upload>;
  /** `POST /public/stores/{storeId}/shipping-options`: delivery choices for a cart and address. */
  getShippingOptions(
    body: ShippingOptionsRequest,
    options?: RequestOptions
  ): Promise<ShippingOptions>;
  /** `POST /public/stores/{storeId}/quote`: every figure the shopper sees. Stores nothing. */
  quote(body: QuoteRequest, options?: RequestOptions): Promise<Quote>;
  /**
   * `POST /public/stores/{storeId}/checkout`: makes the order and returns it,
   * with `checkoutUrl`, the hosted pay page to send the shopper to.
   */
  checkout(body: CheckoutRequest, options?: RequestOptions): Promise<Order>;
  /** `GET /public/orders/{token}`: an order by its public token (the pay page's). */
  getOrder(token: string, options?: RequestOptions): Promise<Order>;
  /**
   * `GET /public/orders/{token}/receipt`: the order's receipt, a PDF made
   * as the order stands now (payments and refunds included). `filename` is
   * the server's (`Receipt-<orderNumber>.pdf`), or one made from
   * `orderNumber` when the header can't be read. Save it in a browser with
   * `saveReceipt`.
   */
  downloadReceipt(
    token: string,
    options?: RequestOptions & {
      /** The order's number, for the fallback file name. */
      orderNumber?: string;
    }
  ): Promise<Receipt>;
}

/** A downloaded receipt: the PDF and the name to save it under. */
export interface Receipt {
  blob: Blob;
  filename: string;
}

/** The origin with any trailing slash or `/api/v1` taken off. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api\/v1$/, "");
}

const seg = (s: string) => encodeURIComponent(s);

/**
 * A typed client for the public store API. It needs no credentials (the
 * routes are public and CORS is open), touches no browser global when
 * created, and works in a browser, Node 20+, a Next.js server component or
 * an edge runtime.
 */
/** The production API origin, used when no `baseUrl` is given. */
export const DEFAULT_BASE_URL = "https://api.bookingbutler.ai";

export function createStoreClient(options: StoreClientOptions): StoreClient {
  const { storeId } = options;
  if (!storeId) throw new Error("createStoreClient: storeId is required");
  const baseUrl = normalizeBaseUrl(options.baseUrl || DEFAULT_BASE_URL);
  const api = `${baseUrl}/api/v1`;
  const store = `${api}/public/stores/${seg(storeId)}`;
  // Looked up per call, so creating a client during SSR touches nothing.
  const doFetch: typeof fetch = options.fetch ?? ((...a) => fetch(...a));

  /** Sends a request; any non-2xx answer (or none) throws a `StoreApiError`. */
  async function send(
    method: "GET" | "POST",
    url: string,
    body: unknown,
    opts: RequestOptions,
    accept: string
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: accept,
      ...options.headers,
    };
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      // JSON always: the API counts a quote sent any other way against the
      // tighter limit of a taxed quote.
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await doFetch(url, {
        ...opts.init,
        method,
        headers: { ...headers, ...(opts.init?.headers as object) },
        body: payload,
        signal: opts.signal ?? opts.init?.signal ?? null,
      });
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      throw new StoreApiError({ status: 0, method, url, cause });
    }
    if (!res.ok) {
      const parsed = await readBody(res);
      throw new StoreApiError({
        status: res.status,
        body: parsed,
        method,
        url,
      });
    }
    return res;
  }

  async function request<T>(
    method: "GET" | "POST",
    url: string,
    body: unknown,
    opts: RequestOptions = {}
  ): Promise<T> {
    const res = await send(method, url, body, opts, "application/json");
    return (await readBody(res)) as T;
  }

  const query = (params?: ListListingsParams) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {}))
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    const s = qs.toString();
    return s ? `?${s}` : "";
  };

  return {
    storeId,
    baseUrl,
    getStore: (o) => request<Store>("GET", store, undefined, o),
    listListings: (params, o) =>
      request<ListingPage>(
        "GET",
        `${store}/listings${query(params)}`,
        undefined,
        o
      ),
    getListing: (listingId, o) =>
      request<Listing>(
        "GET",
        `${store}/listings/${seg(listingId)}`,
        undefined,
        o
      ),
    uploadFile: (file, o = {}) => {
      const form = new FormData();
      const name = o.fileName ?? (file as Partial<File>).name ?? "upload";
      form.append("file", file, name);
      return request<Upload>("POST", `${store}/uploads`, form, o);
    },
    getShippingOptions: (body, o) =>
      request<ShippingOptions>("POST", `${store}/shipping-options`, body, o),
    quote: (body, o) => request<Quote>("POST", `${store}/quote`, body, o),
    checkout: (body, o) => request<Order>("POST", `${store}/checkout`, body, o),
    getOrder: (token, o) =>
      request<Order>("GET", `${api}/public/orders/${seg(token)}`, undefined, o),
    async downloadReceipt(token, o = {}) {
      const url = `${api}/public/orders/${seg(token)}/receipt`;
      // An error answers in JSON (`{error, code}`), so both are accepted.
      const res = await send(
        "GET",
        url,
        undefined,
        o,
        "application/pdf, application/json"
      );
      let blob: Blob;
      try {
        blob = await res.blob();
      } catch (cause) {
        if (isAbortError(cause)) throw cause;
        throw new StoreApiError({ status: 0, method: "GET", url, cause });
      }
      return {
        blob,
        filename: receiptFileName(
          res.headers.get("Content-Disposition"),
          o.orderNumber
        ),
      };
    },
  };
}

/** The body as JSON, or as text when it isn't JSON; undefined when empty. */
async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
