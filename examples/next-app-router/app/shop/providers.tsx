"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Store } from "@bookingbutler/store";
import { StoreProvider, type StorePaths } from "@bookingbutler/store/react";
import { API_URL, STORE_ID } from "./store";

// Module scope: one object, so the provider's value doesn't change per render.
const paths: StorePaths = {
  shop: "/shop",
  listing: (l) => `/shop/${l.id}`,
  cart: "/shop/cart",
  checkout: "/shop/checkout",
};

export function ShopProviders({
  initialStore,
  children,
}: {
  initialStore?: Store;
  children: ReactNode;
}) {
  return (
    <StoreProvider
      storeId={STORE_ID}
      baseUrl={API_URL}
      linkComponent={Link}
      paths={paths}
      {...(initialStore ? { initialStore } : {})}
    >
      {children}
    </StoreProvider>
  );
}
