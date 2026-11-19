"use client";

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  createCart,
  createQuoter,
  createStoreClient,
  createUploader,
  type CartStorage,
  type CartStore,
  type Quoter,
  type StoreClient,
  type Listing,
  type Store,
  type StoreFailure,
  type FieldErrors,
  type UploadFile,
} from "@bookingbutler/store";

/** Anything that renders a link: `"a"` by default, or Next's `Link`. */
export type LinkComponent = ComponentType<{
  href: string;
  className?: string;
  children?: ReactNode;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  "aria-label"?: string;
  "aria-current"?: React.AriaAttributes["aria-current"];
}>;

const PlainLink: LinkComponent = ({ children, ...props }) => (
  <a {...props}>{children}</a>
);

/** What the cart and the checkout share about a refusal, so each can show its part. */
export interface CheckoutFeedback {
  /** The last refused checkout (or taxed quote that named a line). */
  failure: StoreFailure | null;
  /** Answers checked before sending, by cart line key. */
  lineErrors: Record<string, FieldErrors>;
}

interface FeedbackStore {
  get(): CheckoutFeedback;
  set(patch: Partial<CheckoutFeedback>): void;
  subscribe(listener: () => void): () => void;
}

const EMPTY_FEEDBACK: CheckoutFeedback = { failure: null, lineErrors: {} };

function createFeedbackStore(): FeedbackStore {
  let value = EMPTY_FEEDBACK;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(patch) {
      value = { ...value, ...patch };
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Where the components link to, set once on the provider so a Next.js
 * server page can render them without passing functions (which a server
 * component can't hand to a client one).
 */
export interface StorePaths {
  /** A listing's page, e.g. `(l) => \`/shop/${l.id}\``. */
  listing?: (listing: Listing) => string;
  /** The listings page ("All listings", "Keep shopping"). */
  shop?: string;
  cart?: string;
  checkout?: string;
}

export interface StoreContextValue {
  storeId: string;
  paths: StorePaths;
  client: StoreClient;
  cart: CartStore;
  upload: UploadFile;
  locale: string;
  Link: LinkComponent;
  /** The cart's goods-only quote, shared by every `useCartQuote` on the page. */
  goodsQuoter: Quoter;
  goodsUsers: { count: number };
  feedback: FeedbackStore;
  /** `GET /stores/{id}`, fetched once per provider and shared. */
  storeCache: { promise?: Promise<Store>; data?: Store };
}

export const StoreContext = createContext<StoreContextValue | null>(null);

export interface StoreProviderProps {
  /** The public store's id. */
  storeId: string;
  /** The API origin (no `/api/v1`). Defaults to production, `https://api.bookingbutler.ai`. */
  baseUrl?: string;
  /** A fetch to use instead of the global one. */
  fetch?: typeof fetch;
  /** A ready client (tests, or one shared with server code); overrides baseUrl/fetch. */
  client?: StoreClient;
  /** A ready cart; by default one is made for the store, kept in localStorage. */
  cart?: CartStore;
  /** Where the default cart is kept; `null` for memory only. */
  storage?: CartStorage | null;
  /** Locale for money and numbers. Default "en-US" (the same on server and browser). */
  locale?: string;
  /** Renders every link the components draw, e.g. Next.js `Link`. */
  linkComponent?: LinkComponent;
  /** The store, fetched on the server, so `useStore` starts with it. */
  initialStore?: Store;
  /** Where the components link to (listing pages, cart, checkout). */
  paths?: StorePaths;
  children?: ReactNode;
}

/**
 * Puts a store in reach of every hook and component below it. Safe to render
 * from a Next.js server component (pass plain props); nothing touches
 * `window` or `localStorage` until the browser.
 */
export function StoreProvider({
  storeId,
  baseUrl,
  fetch: fetchImpl,
  client: givenClient,
  cart: givenCart,
  storage,
  locale = "en-US",
  linkComponent,
  initialStore,
  paths,
  children,
}: StoreProviderProps) {
  const client = useMemo(
    () =>
      givenClient ??
      createStoreClient({
        storeId,
        baseUrl,
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      }),
    [givenClient, storeId, baseUrl, fetchImpl]
  );
  const cart = useMemo(
    () =>
      givenCart ??
      createCart({ storeId, ...(storage !== undefined ? { storage } : {}) }),
    [givenCart, storeId, storage]
  );
  const goodsQuoter = useMemo(() => createQuoter({ client }), [client]);
  const goodsUsers = useMemo(() => ({ count: 0 }), [goodsQuoter]);
  const feedback = useMemo(() => createFeedbackStore(), [cart]);
  const upload = useMemo(() => createUploader(client), [client]);
  const initialRef = useRef(initialStore);
  const storeCache = useMemo(
    () => (initialRef.current ? { data: initialRef.current } : {}),
    [client]
  );

  const value = useMemo<StoreContextValue>(
    () => ({
      storeId,
      paths: paths ?? {},
      client,
      cart,
      upload,
      locale,
      Link: linkComponent ?? PlainLink,
      goodsQuoter,
      goodsUsers,
      feedback,
      storeCache,
    }),
    [
      storeId,
      paths,
      client,
      cart,
      upload,
      locale,
      linkComponent,
      goodsQuoter,
      goodsUsers,
      feedback,
      storeCache,
    ]
  );
  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}

/** The provider's value. Throws outside a `StoreProvider`. */
export function useStoreContext(): StoreContextValue {
  const value = useContext(StoreContext);
  if (!value)
    throw new Error(
      "@bookingbutler/store/react: wrap this part of the page in <StoreProvider storeId>."
    );
  return value;
}

/** The typed API client, for anything the hooks don't cover. */
export const useStoreClient = (): StoreClient => useStoreContext().client;
