import {
  applyCartAction,
  cartCurrency,
  cartItemCount,
  EMPTY_CART,
  parseStoredCart,
  type Cart,
  type CartAction,
  type CartLine,
  type CartResult,
} from "./cart";
import type { FieldDrafts } from "./fieldAnswers";
import type { CurrencyCode, LineSize } from "./types";

/** The slice of `Storage` a cart needs; `localStorage` fits. */
export interface CartStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CreateCartOptions {
  storeId: string;
  /**
   * Where the cart is kept. Defaults to `window.localStorage`, looked up on
   * first use (never at import or creation), so the cart is SSR-safe. Pass
   * `null` for a cart that lives only in memory.
   */
  storage?: CartStorage | null;
  /** The storage key; defaults to `bookingbutler.cart.<storeId>`. */
  storageKey?: string;
  /** Follow changes another tab makes to the same cart. Default true. */
  syncTabs?: boolean;
}

export interface CartStore {
  readonly storeId: string;
  readonly storageKey: string;
  /** The current cart. The same object until something changes it. */
  getSnapshot(): Cart;
  /** Called after every change. Returns an unsubscribe function. */
  subscribe(listener: (cart: Cart) => void): () => void;
  /** Applies a change; the result says whether the rules allowed it. */
  dispatch(action: CartAction): CartResult;
  add(line: CartLine): CartResult;
  setQuantity(index: number, quantity: number): CartResult;
  /** A new size for a line by size; `undefined` while it is half typed. */
  setSize(index: number, size: LineSize | undefined): CartResult;
  setAnswers(index: number, answers: FieldDrafts): CartResult;
  remove(index: number): CartResult;
  clear(): CartResult;
  /** How many items, for a badge. */
  itemCount(): number;
  currency(): CurrencyCode | undefined;
  /** Re-read storage (e.g. after the page was restored from bfcache). */
  reload(): void;
}

export const cartStorageKey = (storeId: string) =>
  `bookingbutler.cart.${storeId}`;

const defaultStorage = (): CartStorage | null => {
  try {
    return typeof window !== "undefined" && window.localStorage
      ? window.localStorage
      : null;
  } catch {
    // Blocked site data, sandboxed iframes: storage access itself throws.
    return null;
  }
};

/**
 * A framework-free, observable cart for one store, kept in localStorage.
 *
 * Every change goes through `applyCartAction`, so the cart can never break a
 * rule checkout enforces (one currency, ≤50 lines, 1–999 of each); a refused
 * change returns `{ ok: false, refusal }` and leaves the cart as it was.
 * `getSnapshot`/`subscribe` fit React's `useSyncExternalStore` directly.
 */
export function createCart(options: CreateCartOptions): CartStore {
  const { storeId, syncTabs = true } = options;
  if (!storeId) throw new Error("createCart: storeId is required");
  const storageKey = options.storageKey ?? cartStorageKey(storeId);
  const listeners = new Set<(cart: Cart) => void>();
  let cart: Cart = EMPTY_CART;
  let loaded = false;
  let detachStorage: (() => void) | undefined;

  const storage = (): CartStorage | null =>
    options.storage === undefined ? defaultStorage() : options.storage;

  const read = (): Cart => {
    try {
      return parseStoredCart(storage()?.getItem(storageKey));
    } catch {
      return EMPTY_CART;
    }
  };

  const write = (next: Cart) => {
    try {
      const s = storage();
      if (!s) return;
      if (next.lines.length === 0) s.removeItem(storageKey);
      else s.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Full or blocked storage: the cart still works for this visit.
    }
  };

  const emit = () => {
    for (const listener of [...listeners]) listener(cart);
  };

  const ensureLoaded = () => {
    if (loaded) return;
    // On a server there is nothing to read yet; try again in the browser.
    if (options.storage === undefined && typeof window === "undefined") return;
    loaded = true;
    cart = read();
  };

  const attachStorageEvents = () => {
    if (!syncTabs || detachStorage || typeof window === "undefined") return;
    if (options.storage === null) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== storageKey) return;
      const next = read();
      if (JSON.stringify(next) === JSON.stringify(cart)) return;
      cart = next;
      emit();
    };
    window.addEventListener("storage", onStorage);
    detachStorage = () => window.removeEventListener("storage", onStorage);
  };

  const dispatch = (action: CartAction): CartResult => {
    ensureLoaded();
    const result = applyCartAction(cart, action);
    if (result.ok && result.cart !== cart) {
      cart = result.cart;
      write(cart);
      emit();
    }
    return result;
  };

  return {
    storeId,
    storageKey,
    getSnapshot() {
      ensureLoaded();
      return cart;
    },
    subscribe(listener) {
      ensureLoaded();
      listeners.add(listener);
      attachStorageEvents();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          detachStorage?.();
          detachStorage = undefined;
        }
      };
    },
    dispatch,
    add: (line) => dispatch({ type: "add", line }),
    setQuantity: (index, quantity) =>
      dispatch({ type: "setQuantity", index, quantity }),
    setSize: (index, size) => dispatch({ type: "setSize", index, size }),
    setAnswers: (index, answers) =>
      dispatch({ type: "setAnswers", index, answers }),
    remove: (index) => dispatch({ type: "remove", index }),
    clear: () => dispatch({ type: "clear" }),
    itemCount: () => {
      ensureLoaded();
      return cartItemCount(cart);
    },
    currency: () => {
      ensureLoaded();
      return cartCurrency(cart);
    },
    reload() {
      loaded = false;
      const before = cart;
      ensureLoaded();
      if (JSON.stringify(before) !== JSON.stringify(cart)) emit();
    },
  };
}
