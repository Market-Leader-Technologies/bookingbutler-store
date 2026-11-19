import "@bookingbutler/store/styles.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { ShopProviders } from "./providers";
import { serverClient } from "./store";
import { CartLink } from "./cart-link";

export default async function ShopLayout({
  children,
}: {
  children: ReactNode;
}) {
  const store = await serverClient.getStore().catch(() => undefined);
  return (
    <ShopProviders {...(store ? { initialStore: store } : {})}>
      <header
        style={{ display: "flex", gap: 16, alignItems: "center", padding: 16 }}
      >
        <Link href="/shop" style={{ fontWeight: 700, flex: 1 }}>
          {store?.name ?? "Shop"}
        </Link>
        <CartLink />
      </header>
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        {children}
      </main>
    </ShopProviders>
  );
}
