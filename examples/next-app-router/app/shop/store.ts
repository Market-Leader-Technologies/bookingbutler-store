import { createStoreClient } from "@bookingbutler/store";

export const STORE_ID = process.env.NEXT_PUBLIC_BOOKINGBUTLER_STORE_ID!;
// Optional: unset means production (https://api.bookingbutler.ai).
export const API_URL = process.env.NEXT_PUBLIC_BOOKINGBUTLER_API_URL;

/** For server components: the same client, with Next's fetch cache. */
export const serverClient = createStoreClient({
  storeId: STORE_ID,
  baseUrl: API_URL,
  fetch: (input, init) =>
    fetch(input, { ...init, next: { revalidate: 60 } } as RequestInit),
});
