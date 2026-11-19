# Next.js (app router) example

Not a full app: drop `app/shop/` into a Next.js 15/16 project
(`npm i @bookingbutler/store`) and set:

```bash
# .env.local
NEXT_PUBLIC_BOOKINGBUTLER_API_URL=https://<your API origin>
NEXT_PUBLIC_BOOKINGBUTLER_STORE_ID=<your store id>
```

| File                            | Kind   | What it does                                                                                                               |
| ------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| `app/shop/providers.tsx`        | client | `StoreProvider` with Next's `Link` and the shop's paths (functions can't cross from a server component, so they live here) |
| `app/shop/layout.tsx`           | server | Loads the stylesheet, fetches the store once for the header and `initialStore`                                             |
| `app/shop/page.tsx`             | server | Fetches the first page of listings on the server (SEO, no spinner), hands it to `<ListingGrid>`                            |
| `app/shop/[listingId]/page.tsx` | server | Fetches one listing (and its `<title>`), renders `<ListingDetail>`                                                         |
| `app/shop/cart/page.tsx`        | server | `<Cart>`                                                                                                                   |
| `app/shop/checkout/page.tsx`    | server | `<Checkout>`: delivery, details, the server's totals, then the hosted pay page                                             |
