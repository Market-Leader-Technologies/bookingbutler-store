"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  classifyError,
  isAbortError,
  isStoreApiError,
  type ListListingsParams,
  type Listing,
  type ListingPage,
  type Store,
  type StoreFailure,
} from "@bookingbutler/store";
import { useStoreContext } from "./context";

export interface AsyncResult<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  failure: StoreFailure | null;
  /** A 404: the store is private or gone, or doesn't show that listing. */
  notFound: boolean;
  refetch: () => void;
}

/**
 * One read, newest wins: a changed key aborts what is in flight, and only
 * the request for the current key writes. `initialData` (from a server
 * render) is shown first and not fetched again for its key.
 */
function useRead<T>(
  key: string | null,
  read: (signal: AbortSignal) => Promise<T>,
  initialData?: T
): AsyncResult<T> {
  const initialKey = useRef(initialData !== undefined ? key : null);
  const [state, setState] = useState<{
    key: string | null;
    data: T | undefined;
    loading: boolean;
    failure: StoreFailure | null;
    notFound: boolean;
  }>({
    key,
    data: initialData,
    loading: key != null && initialData === undefined,
    failure: null,
    notFound: false,
  });
  const [nonce, setNonce] = useState(0);
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    if (key == null) {
      setState((s) => ({ ...s, key, loading: false }));
      return;
    }
    if (nonce === 0 && initialKey.current === key) {
      initialKey.current = null;
      return;
    }
    const controller = new AbortController();
    setState((s) => ({
      key,
      // A new key shows nothing of the old one's.
      data: s.key === key ? s.data : undefined,
      loading: true,
      failure: null,
      notFound: false,
    }));
    readRef
      .current(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ key, data, loading: false, failure: null, notFound: false });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        setState({
          key,
          data: undefined,
          loading: false,
          failure: classifyError(err),
          notFound: isStoreApiError(err) && err.status === 404,
        });
      });
    return () => controller.abort();
  }, [key, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  const current = state.key === key;
  return {
    data: current ? state.data : undefined,
    loading: current ? state.loading : key != null,
    error: current ? (state.failure?.message ?? null) : null,
    failure: current ? state.failure : null,
    notFound: current && state.notFound,
    refetch,
  };
}

export interface UseStoreResult extends AsyncResult<Store> {
  store: Store | undefined;
  /** The store said it is closed (a temporary store past its closing time). */
  closed: boolean;
}

/** The store's name, description, categories and tags. Fetched once per provider. */
export function useStore(): UseStoreResult {
  const { client, storeId, storeCache } = useStoreContext();
  const result = useRead<Store>(
    storeId,
    () => {
      storeCache.promise ??= client.getStore().then((s) => {
        storeCache.data = s;
        return s;
      });
      const p = storeCache.promise;
      p.catch(() => {
        if (storeCache.promise === p) storeCache.promise = undefined;
      });
      return p;
    },
    storeCache.data
  );
  return {
    ...result,
    refetch: () => {
      storeCache.promise = undefined;
      result.refetch();
    },
    store: result.data,
    closed: result.data?.closed === true,
  };
}

export interface UseListingsOptions {
  /** A page fetched on the server, for its params. */
  initialData?: ListingPage;
  /** false waits (e.g. until a search is typed). */
  enabled?: boolean;
}

export interface UseListingsResult extends AsyncResult<ListingPage> {
  listings: Listing[];
  total: number | undefined;
  hasMore: boolean;
  /** Fetches the next page and appends it. */
  loadMore: () => void;
  loadingMore: boolean;
  loadMoreError: string | null;
}

/**
 * A page of the store's listings, searched (`q`) and filtered
 * (`categoryId`, `tagId`). Changing the params starts over; `loadMore`
 * appends the next page (by cursor when the server gives one).
 */
export function useListings(
  params: ListListingsParams = {},
  { initialData, enabled = true }: UseListingsOptions = {}
): UseListingsResult {
  const { client, storeId } = useStoreContext();
  const key = enabled ? JSON.stringify([storeId, params]) : null;
  const result = useRead<ListingPage>(
    key,
    (signal) => client.listListings(params, { signal }),
    initialData
  );
  const [more, setMore] = useState<{
    key: string | null;
    pages: ListingPage[];
    loading: boolean;
    error: string | null;
  }>({ key, pages: [], loading: false, error: null });
  const moreFor =
    more.key === key ? more : { pages: [], loading: false, error: null };
  const pages = useMemo(
    () => (result.data ? [result.data, ...moreFor.pages] : []),
    [result.data, moreFor.pages]
  );
  const last = pages[pages.length - 1];
  const listings = useMemo(() => {
    const seen = new Set<string>();
    const out: Listing[] = [];
    for (const page of pages)
      for (const l of page.listings ?? []) {
        if (l.id && seen.has(l.id)) continue;
        if (l.id) seen.add(l.id);
        out.push(l);
      }
    return out;
  }, [pages]);
  const loadingRef = useRef(false);

  const loadMore = useCallback(() => {
    if (!last?.hasMore || loadingRef.current || key == null) return;
    loadingRef.current = true;
    const forKey = key;
    setMore((m) => ({
      key: forKey,
      pages: m.key === forKey ? m.pages : [],
      loading: true,
      error: null,
    }));
    const next: ListListingsParams = last.nextCursor
      ? { ...params, after: last.nextCursor, offset: undefined }
      : { ...params, offset: (params.offset ?? 0) + listings.length };
    client
      .listListings(next)
      .then((page) =>
        setMore((m) =>
          m.key === forKey
            ? { ...m, pages: [...m.pages, page], loading: false }
            : m
        )
      )
      .catch((err: unknown) =>
        setMore((m) =>
          m.key === forKey
            ? { ...m, loading: false, error: classifyError(err).message }
            : m
        )
      )
      .finally(() => {
        loadingRef.current = false;
      });
  }, [client, key, last, listings.length, params]);

  return {
    ...result,
    listings,
    total: result.data?.total,
    hasMore: Boolean(last?.hasMore),
    loadMore,
    loadingMore: moreFor.loading,
    loadMoreError: moreFor.error,
  };
}

export interface UseListingResult extends AsyncResult<Listing> {
  listing: Listing | undefined;
}

/** One listing with its options, prices and form. `null` id waits. */
export function useListing(
  listingId: string | null | undefined,
  { initialData }: { initialData?: Listing } = {}
): UseListingResult {
  const { client, storeId } = useStoreContext();
  const result = useRead<Listing>(
    listingId ? JSON.stringify([storeId, listingId]) : null,
    (signal) => client.getListing(listingId!, { signal }),
    initialData
  );
  return { ...result, listing: result.data };
}
