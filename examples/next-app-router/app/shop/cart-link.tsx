"use client";

import Link from "next/link";
import { useCart } from "@bookingbutler/store/react";

/** "Cart (2)": hooks-only, so it can look like anything. */
export function CartLink() {
  const { itemCount } = useCart();
  return (
    <Link href="/shop/cart" className="bb-button bb-button--secondary">
      Cart ({itemCount})
    </Link>
  );
}
