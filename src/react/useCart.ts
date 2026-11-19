"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  cartCurrency,
  cartItemCount,
  createQuoter,
  createShippingQuoter,
  EMPTY_CART,
  IDLE_QUOTE,
  IDLE_SHIPPING,
  quoteView,
  shippingOptionsKey,
  singleLineCart,
  TAXED_QUOTE_DEBOUNCE_MS,
  type Address,
  type Cart,
  type CartAction,
  type CartLine,
  type CartResult,
  type CartStore,
  type CheckoutShipping,
  type CurrencyCode,
  type FieldDrafts,
  type LineSize,
  type PricingRate,
  type QuoteView,
  type ShippingOption,
  type ShippingOptions,
  type StoreFailure,
} from "@bookingbutler/store";
import { useStoreContext, type CheckoutFeedback } from "./context";

const serverCart = () => EMPTY_CART;
const serverQuote = () => IDLE_QUOTE;
const serverShipping = () => IDLE_SHIPPING;

export interface UseCartResult {
  cart: Cart;
  lines: CartLine[];
  itemCount: number;
  currency: CurrencyCode | undefined;
  isEmpty: boolean;
  add(line: CartLine): CartResult;
  setQuantity(index: number, quantity: number): CartResult;
  setSize(index: number, size: LineSize | undefined): CartResult;
  setAnswers(index: number, answers: FieldDrafts): CartResult;
  remove(index: number): CartResult;
  clear(): CartResult;
  dispatch(action: CartAction): CartResult;
  /** The framework-free cart underneath. */
  store: CartStore;
}

/**
 * The shopper's cart. Server-rendered and first-hydrated as empty, then the
 * saved cart, so the markup always matches during hydration.
 */
export function useCart(): UseCartResult {
  const { cart: store } = useStoreContext();
  const cart = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    serverCart
  );
  return useMemo(
    () => ({
      cart,
      lines: cart.lines,
      itemCount: cartItemCount(cart),
      currency: cartCurrency(cart),
      isEmpty: cart.lines.length === 0,
      add: store.add,
      setQuantity: store.setQuantity,
      setSize: store.setSize,
      setAnswers: store.setAnswers,
      remove: store.remove,
      clear: store.clear,
      dispatch: store.dispatch,
      store,
    }),
    [cart, store]
  );
}

export interface CartQuoteResult extends QuoteView {
  refetch: () => void;
}

/**
 * What the cart comes to, as the server prices it (`POST /quote`, no tax):
 * each line's amount, the subtotal, and what is due today when a line is
 * paid by deposit. One request serves every caller on the page; it is asked
 * again after a pause whenever the goods change, the newest answer winning.
 */
export function useCartQuote({
  enabled = true,
}: { enabled?: boolean } = {}): CartQuoteResult {
  const { goodsQuoter: quoter, goodsUsers } = useStoreContext();
  const { cart } = useCart();
  const state = useSyncExternalStore(
    quoter.subscribe,
    quoter.getState,
    serverQuote
  );
  useEffect(() => {
    if (enabled) quoter.update(cart);
  }, [quoter, cart, enabled]);
  useEffect(() => {
    if (!enabled) return;
    goodsUsers.count += 1;
    return () => {
      goodsUsers.count -= 1;
      if (goodsUsers.count === 0) quoter.cancel();
    };
  }, [quoter, goodsUsers, enabled]);
  return {
    ...quoteView(state, cart, undefined, enabled),
    refetch: quoter.refetch,
  };
}

/**
 * The checkout step's quote: the goods with the delivery chosen and
 * `includeTax: true`, giving shipping, tax, the total and what is due today
 * exactly as `POST /checkout` will charge them (when `quote.complete`).
 *
 * Its own request, never shared with `useCartQuote`. Pass `enabled: false`
 * until delivery is chosen — `includeTax` must not be sent before then.
 *
 * Each taxed quote is a calculation on the shop's payment account, with a
 * tighter limit (20 in a burst, then 1 every 5 seconds), so it waits longer
 * after a change (`TAXED_QUOTE_DEBOUNCE_MS`) and never asks twice for the
 * same request: going back to an earlier choice shows its answer again. A
 * 429 keeps the last figures (`held`) and asks again after a few seconds.
 */
export function useCheckoutQuote({
  shipping,
  enabled = true,
}: {
  /** The delivery choice; leave out at a store with no delivery methods. */
  shipping?: CheckoutShipping;
  enabled?: boolean;
}): CartQuoteResult {
  const { client } = useStoreContext();
  const { cart } = useCart();
  const quoter = useMemo(
    () =>
      createQuoter({
        client,
        debounceMs: TAXED_QUOTE_DEBOUNCE_MS,
        reuseAnswers: true,
      }),
    [client]
  );
  const state = useSyncExternalStore(
    quoter.subscribe,
    quoter.getState,
    serverQuote
  );
  const checkout = { shipping, includeTax: true };
  // Every render hands over the current request; the quoter only sends
  // when it differs from the last one.
  useEffect(() => {
    quoter.update(cart, { checkout, enabled });
  });
  useEffect(() => () => quoter.cancel(), [quoter]);
  return {
    ...quoteView(state, cart, checkout, enabled),
    refetch: quoter.refetch,
  };
}

/**
 * The price of one line before it is in the cart: a listing's price at the
 * size and quantity typed, as a one-line quote (no tax). `unitAmountCents`
 * each and `amountCents` for all of them, worked out by the server.
 */
export function useListingQuote({
  listingId,
  priceId,
  quantity,
  rate,
  size,
  enabled = true,
}: {
  listingId?: string;
  priceId?: string;
  quantity: number;
  rate?: PricingRate;
  size?: LineSize;
  enabled?: boolean;
}): CartQuoteResult & { line: QuoteView["lines"][number] } {
  const { client } = useStoreContext();
  const quoter = useMemo(() => createQuoter({ client }), [client]);
  const state = useSyncExternalStore(
    quoter.subscribe,
    quoter.getState,
    serverQuote
  );
  const ready = enabled && Boolean(listingId && priceId);
  const sizeKey = JSON.stringify(size ?? null);
  const cart = useMemo(
    () =>
      listingId && priceId
        ? singleLineCart({
            listingId,
            priceId,
            quantity,
            ...(rate ? { rate } : {}),
            ...(size ? { size } : {}),
          })
        : EMPTY_CART,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listingId, priceId, quantity, rate, sizeKey]
  );
  useEffect(() => {
    quoter.update(cart, { enabled: ready });
  }, [quoter, cart, ready]);
  useEffect(() => () => quoter.cancel(), [quoter]);
  const view = quoteView(state, cart, undefined, ready);
  return {
    ...view,
    line: view.quote ? view.lines[0] : undefined,
    refetch: quoter.refetch,
  };
}

export interface ShippingOptionsResult {
  /** The newest answer, kept while a newer one is asked for. */
  data: ShippingOptions | null;
  options: ShippingOption[];
  /** The store has delivery methods (`false`: pickup only, nothing to choose). */
  configured: boolean | undefined;
  loading: boolean;
  /**
   * The options answer the cart and address as they are now (not still
   * being asked for a change). Anything that depends on the delivery
   * choice, like the taxed quote, waits for this.
   */
  current: boolean;
  /** A 429: asked again in a few seconds, the last options kept. */
  retrying: boolean;
  error: string | null;
  failure: StoreFailure | null;
  refetch: () => void;
}

/**
 * The store's delivery options for the cart and an address, asked again as
 * the address is typed (debounced, newest wins). The address goes once it
 * has a postal code; until then only pickup can be offered.
 */
export function useShippingOptions({
  address = {},
  enabled = true,
}: { address?: Address; enabled?: boolean } = {}): ShippingOptionsResult {
  const { client } = useStoreContext();
  const { cart } = useCart();
  const quoter = useMemo(() => createShippingQuoter({ client }), [client]);
  const state = useSyncExternalStore(
    quoter.subscribe,
    quoter.getState,
    serverShipping
  );
  useEffect(() => {
    quoter.update(cart, address, { enabled });
  });
  useEffect(() => () => quoter.cancel(), [quoter]);
  return {
    data: state.options,
    options: state.options?.options ?? [],
    configured: state.options?.configured,
    loading: state.loading,
    current:
      enabled &&
      !state.loading &&
      state.options != null &&
      state.answeredFor === shippingOptionsKey(cart, address),
    retrying: state.retrying,
    error: state.error,
    failure: state.failure,
    refetch: quoter.refetch,
  };
}

/** The refusal the cart and checkout share (set by `useCheckout`). */
export function useCheckoutFeedback(): CheckoutFeedback & {
  set: (patch: Partial<CheckoutFeedback>) => void;
} {
  const { feedback } = useStoreContext();
  const value = useSyncExternalStore(
    feedback.subscribe,
    feedback.get,
    feedback.get
  );
  const set = useCallback(
    (patch: Partial<CheckoutFeedback>) => feedback.set(patch),
    [feedback]
  );
  return { ...value, set };
}

/** Money and numbers in the provider's locale. */
export function useLocale(): string {
  return useStoreContext().locale;
}
