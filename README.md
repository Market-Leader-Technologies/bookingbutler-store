# @bookingbutler/store

Put a BookingButler storefront on any website: browse listings, keep a cart,
show the server's prices and totals, and send the shopper to the hosted pay
page to check out.

- **`@bookingbutler/store`**: the framework-free core. A typed client for the
  public store API, an observable cart kept in `localStorage`, debounced
  newest-wins quoting, error classification and display formatting. Zero
  runtime dependencies, nothing touched at import time (SSR-safe).
- **`@bookingbutler/store/react`**: hooks and accessible, unstyled components
  for React 18+ (built for Next.js app router; every file is `"use client"`).
- **`@bookingbutler/store/styles.css`**: an optional default look.

The public store routes need no login and answer any origin (CORS `*`), so
everything runs in the shopper's browser with no secrets. Payment happens on
the hosted pay page: the SDK never talks to the payment provider.

## Install

```bash
npm install @bookingbutler/store
# or: pnpm add @bookingbutler/store
```

Node 20+ for server rendering. React 18 or 19 for the React kit (an optional
peer dependency: the core needs nothing).

You need one value from BookingButler, and optionally a second:

| Value     | Where                                                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `storeId` | the store's id (Store settings). The store must be public.                                                                                     |
| `baseUrl` | optional: the API origin (no `/api/v1`). Defaults to production, `https://api.bookingbutler.ai`; set it only to point at a dev or staging API. |

## The one rule: no money math on the client

Every price, deposit, subtotal, shipping charge, tax and total the shopper
sees comes from `POST /public/stores/{storeId}/quote`, which runs the
checkout's own code. The SDK never multiplies a unit price by a quantity,
never adds lines up and never works out a deposit or tax. A price with a rate
(by size, in tiers, with a minimum) or a listing that takes a deposit would
come out wrong the moment a page did.

What this means for your code:

- Show `quote.lines[i].amountCents`, `quote.subtotalCents`, `quote.totalCents`,
  `quote.dueNowCents`. Never `unitAmountCents * quantity`.
- Until the quote answers, show "working it out". After a failed quote, show
  no figures (the hooks' `quote` is `undefined` and `failed` is `true`).
- While shopping, quote **without** `includeTax`. At the checkout step, once
  delivery is chosen, quote again with `shippingMethodId`, the address and
  `includeTax: true`. When `quote.complete` is `true`, those are exactly the
  figures the payment will be for. (Each tax quote is a calculation on the
  shop's payment account, so it waits for a delivery choice.)
- Send the taxed quote with exactly the lines, method and address the
  checkout will send (`quoteRequest` and `checkoutRequest` build both from
  the same cart and choice). The checkout then reuses that quote's tax
  calculation for two minutes instead of making a second one.
- For a delivery, ask for the taxed quote only once the shipping options
  have answered for the address as typed now, and after a longer pause
  (`TAXED_QUOTE_DEBOUNCE_MS`), so typing an address sends one taxed quote,
  not one per pause. Never ask again for a request already answered
  (`createQuoter({ reuseAnswers: true })`). `useCheckout` and `<Checkout>` do
  all of this.
- Checkout lines are `{ listingId, priceId, quantity, size?, fields? }`. Never
  product ids or amounts. `checkoutRequest()` builds them.

The test suite has a tripwire (`tests/core/no-client-math.test.ts`) that fails
on `…Cents *`, `+ …Cents` and the like anywhere in `src/`.

## Quick start: Next.js app router

Four files under `app/shop/` (the whole set, with listing and checkout pages,
is in [`examples/next-app-router`](examples/next-app-router)):

```tsx
// app/shop/providers.tsx
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { StoreProvider, type StorePaths } from "@bookingbutler/store/react";

// Functions (Link, paths) can't be passed from a server component to a
// client one, so they are set here, once.
const paths: StorePaths = {
  shop: "/shop",
  listing: (l) => `/shop/${l.id}`,
  cart: "/shop/cart",
  checkout: "/shop/checkout",
};

export function ShopProviders({ children }: { children: ReactNode }) {
  return (
    <StoreProvider
      storeId={process.env.NEXT_PUBLIC_BOOKINGBUTLER_STORE_ID!}
      baseUrl={process.env.NEXT_PUBLIC_BOOKINGBUTLER_API_URL} // optional; production by default
      linkComponent={Link}
      paths={paths}
    >
      {children}
    </StoreProvider>
  );
}
```

```tsx
// app/shop/layout.tsx
import "@bookingbutler/store/styles.css";
import { ShopProviders } from "./providers";

export default function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ShopProviders>{children}</ShopProviders>;
}
```

```tsx
// app/shop/page.tsx: the listings, with a cart and checkout beside them
import { Cart, Checkout, ListingGrid } from "@bookingbutler/store/react";

export default function ShopPage() {
  return (
    <>
      <ListingGrid />
      <Cart />
      <Checkout />
    </>
  );
}
```

```tsx
// app/shop/[listingId]/page.tsx
import { ListingDetail } from "@bookingbutler/store/react";

export default async function ListingPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  return <ListingDetail listingId={(await params).listingId} />;
}
```

```bash
# .env.local
NEXT_PUBLIC_BOOKINGBUTLER_API_URL=https://<API origin>
NEXT_PUBLIC_BOOKINGBUTLER_STORE_ID=<store id>
```

**Server rendering.** The core client works in server components, so pages
can fetch on the server (SEO, no spinner) and hand the data over:

```tsx
import { createStoreClient } from "@bookingbutler/store";
const client = createStoreClient({ storeId, baseUrl });
const firstPage = await client.listListings({ limit: 24 });
return <ListingGrid initialData={firstPage} params={{ limit: 24 }} />;
// and <ListingDetail listing={await client.getListing(id)} />
```

The cart renders empty on the server and during hydration, then shows the
saved cart, so markup always matches. Money is formatted in `en-US` by default
on both sides (set `locale` on the provider to change it).

## Hooks only

Use the hooks and draw everything yourself. Components and hooks mix freely.

```tsx
"use client";
import { formatMoney } from "@bookingbutler/store";
import { useCart, useCartQuote, useListings } from "@bookingbutler/store/react";

export function MiniShop() {
  const { listings, loading } = useListings({ limit: 12 });
  const cart = useCart();
  const pricing = useCartQuote(); // POST /quote, debounced, newest wins

  return (
    <div>
      {loading && <p>Loading…</p>}
      {listings.map((l) => (
        <p key={l.id}>{l.name}</p>
      ))}
      <p>
        {cart.itemCount} items ·{" "}
        {pricing.subtotalCents != null
          ? formatMoney(pricing.subtotalCents, pricing.quote?.currency)
          : pricing.failed
            ? "—"
            : "Working it out…"}
      </p>
    </div>
  );
}
```

| Hook                                    | Gives                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `useStore()`                            | the store (name, description, categories, tags, `closed`)                                        |
| `useListings(params, opts)`             | a page of listings (`q`, `categoryId`, `tagId`, `limit`), `loadMore`, `hasMore`                  |
| `useListing(id)`                        | one listing with options, prices and its form; `notFound` on 404                                 |
| `useListingSelection(listing)`          | option choice, size draft, quantity, answers, uploads, `add()`: everything `ListingDetail` draws |
| `useListingQuote({...})`                | the server's price for one line at a size and quantity, before it is in the cart                 |
| `useCart()`                             | the cart and `add / setQuantity / setSize / setAnswers / remove / clear`                         |
| `useCartQuote()`                        | the goods quote: per-line `amountCents`, `subtotalCents`, due today (one request per page)       |
| `useShippingOptions({address})`         | delivery options for the cart and address (debounced)                                            |
| `useCheckoutQuote({shipping, enabled})` | the taxed quote; pass `enabled: false` until delivery is chosen                                  |
| `useCheckout()`                         | the whole checkout: contact, address, method, both quotes, validation, `submit()`                |
| `useReceiptDownload({token, order?})`   | an order's receipt: `available`, `downloading`, `error`, `download()`                            |
| `useStoreClient()`                      | the raw typed client                                                                             |

## Vanilla JavaScript

No framework, no build step: the core is one ES module with no imports.

```html
<script type="module">
  import {
    createStoreClient,
    createCart,
    createQuoter,
    formatMoney,
    cardPriceText,
    checkoutRequest,
    redirectToCheckout,
  } from "https://cdn.jsdelivr.net/npm/@bookingbutler/store@0.1.0/dist/index.js";

  const client = createStoreClient({ storeId: "…", baseUrl: "https://…" });
  const cart = createCart({ storeId: client.storeId });
  const quoter = createQuoter({ client });

  const { listings } = await client.listListings({ limit: 24 });
  // … draw listings with cardPriceText(listing) …

  cart.subscribe((c) => quoter.update(c));
  quoter.subscribe(() => {
    const view = quoter.view(); // only figures for the cart as it is now
    subtotal.textContent =
      view.subtotalCents != null
        ? formatMoney(view.subtotalCents, view.quote.currency)
        : "…";
  });
  quoter.update(cart.getSnapshot());

  // Checkout: ids and quantities only, then the hosted pay page.
  const order = await client.checkout(
    checkoutRequest(cart.getSnapshot(), { name, email }, { methodId })
  );
  cart.clear();
  redirectToCheckout(order.checkoutUrl);
</script>
```

A complete page (listings, options, sizes, cart, delivery, taxed totals) is
in [`examples/vanilla.html`](examples/vanilla.html). Run `pnpm build`, serve
the repo root (`python3 -m http.server`), and open
`/examples/vanilla.html?store=<id>` (add `&api=<origin>` for a non-production API).

## Components

All are semantic HTML with labels, live regions for status and errors, and
`aria-invalid`/`aria-describedby` on fields. They are unstyled unless you
import the stylesheet, and every element has a stable `bb-` class plus
`data-state` / `data-selected` / `data-invalid` attributes to style against.
Each takes a `className`.

| Component                                                                        | What it is                                                                                                                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `<StoreProvider>`                                                                | `storeId`; optional `baseUrl`, `fetch`, `client`, `cart`, `storage`, `locale`, `linkComponent`, `paths`, `initialStore`                                |
| `<ListingGrid>`                                                                  | the listings as cards, "Load more"; `params`, `initialData`, `href`, `onSelect`, `renderCard`                                                          |
| `<ListingCard>`                                                                  | one card: image, name, "From $40 · $20 today", payment note                                                                                            |
| `<ListingDetail>`                                                                | images, price or rate + tier table, options, size input with the server's price for it, the line's form (file uploads included), quantity, Add to cart |
| `<AddToCartButton>`                                                              | with a `selection` (from `useListingSelection`) or a ready `line`                                                                                      |
| `<Cart>`                                                                         | lines with quantity, size and details; server-priced amounts, subtotal, due today / invoiced later                                                     |
| `<Checkout>`                                                                     | delivery options + address, contact, the taxed totals, "Continue to payment" → pay page                                                                |
| `<ReceiptLink token order?>`                                                     | "Download receipt" for a placed order; disabled while it downloads, refusals said under it                                                             |
| `<SizeInput>`, `<LineFieldsForm>`, `<RateTable>`, `<Money>`, `<QuantityStepper>` | the pieces, for your own layouts                                                                                                                       |

`data-state` values: listings `loading | ready | empty | error`; cart
`empty | loading | ready | error`; cart line `priced | pricing | needs-size`;
checkout `pending | ready | submitting | closed | empty`; totals
`pending | loading | partial | complete | updating | tax-unavailable | error`
(`updating`: a 429, the last figures shown dimmed until it asks again);
receipt `ready | downloading | error`.

## Theming

```css
@import "@bookingbutler/store/styles.css";

:root {
  --bb-accent: #d9480f; /* buttons, selection, focus */
  --bb-accent-text: #fff;
  --bb-text: #1d1c1a;
  --bb-muted: #6b6860;
  --bb-border: #dedad0;
  --bb-surface: #fff;
  --bb-surface-2: #efede6;
  --bb-danger: #b42318;
  --bb-radius: 14px;
  --bb-font: "Inter", system-ui, sans-serif;
  --bb-card-min: 240px; /* grid column width */
}
```

All rules sit in the `bookingbutler` cascade layer, so any rule of yours that
isn't in a layer wins with no `!important`. With Tailwind v4, import the
stylesheet **before** `tailwindcss` (or declare
`@layer bookingbutler, theme, base, components, utilities;`) so utilities
passed through `className` win too. The default look works from 375px up and
keeps touch targets at least 44px. For dark mode, set the variables under
your own `prefers-color-scheme` or `.dark` rule.

## Errors

Every non-2xx answer throws a `StoreApiError` with `status`, `code` (e.g.
`STORE_CLOSED`), `details`, and the `field` / `lineIndex` / `fieldKey` its
first detail names. No answer at all (offline, CORS) is `status: 0`. A
request cancelled by a newer one rejects with an `AbortError`
(`isAbortError(e)`).

`classifyError(err, { lineNames })` turns one into what to do:

| `kind`             | When                                                        | What to do                                                                                                    |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `invalid`          | 400 naming a field or line                                  | show `message` by `field` / `lineIndex`; `lineSizes[i]` on a size input, `lineFields[i][key]` on a form field |
| …`refetchShipping` | 400 `DELIVERY_METHOD_UNAVAILABLE` / `STORE_HAS_NO_DELIVERY` | ask for the shipping options again and let the shopper choose                                                 |
| …`needsShipping`   | 400 `DELIVERY_METHOD_REQUIRED`                              | `includeTax` was sent with no method at a store that delivers: quote without it until a method is chosen      |
| `closed`           | 400 `STORE_CLOSED`                                          | the store has closed; stop the checkout                                                                       |
| `notTaking`        | 400 "this store is not taking orders online"                | the shop can't take payment: no checkout. A quote without `includeTax` still prices the cart                  |
| `nothingToPay`     | 400 "there is nothing to pay for in this order"             | a taxed quote or checkout of a cart that comes to nothing; no checkout                                        |
| `tax`              | 503                                                         | show subtotal and shipping, "Tax will be added at payment"; checkout may continue                             |
| `rateLimited`      | 429 (any route)                                             | "Too many requests just now. Try again in a moment." See [Rate limits](#rate-limits)                          |
| `missing`          | 404                                                         | the store or a listing is gone                                                                                |
| `network`          | no answer                                                   | offline or blocked                                                                                            |

The codes a 400 can carry (`err.code`): `STORE_CLOSED`,
`DELIVERY_METHOD_REQUIRED`, `DELIVERY_METHOD_UNAVAILABLE`,
`STORE_HAS_NO_DELIVERY`, `FIELD_VALIDATION_ERROR` (with `details` keyed
`lines[i].size`, `lines[i].fields.<key>`, `email`, `shippingAddress`…). A
receipt's 409 carries `ORDER_NOT_PLACED`. Some refusals have no code and are
told by their sentence ("not taking orders online", "nothing to pay for");
`classifyError` reads both.

The hooks and components already do all of this: refusals land on the line or
field they name, a half-typed size (`"4."`) stays as typed, an answer for an
older cart is never shown beside a changed one, and after a failed quote no
figures are shown until one succeeds.

## Receipts

`GET /public/orders/{token}/receipt` answers the order's receipt as a PDF,
made as the order stands now (payments and refunds since included), in the
shop's branding. It exists once the order is placed: `paymentStatus` is
anything but `pending`, including an order placed with nothing charged and a
canceled one.

```tsx
"use client";
import { ReceiptLink } from "@bookingbutler/store/react";

// On your order page, with the order's public token (and the order, if you
// have it; without it the order is read by its token first).
<ReceiptLink token={token} order={order} />;
```

`<ReceiptLink>` draws nothing until the order is placed, is disabled while a
download is in flight (receipts have a limit of their own) and says a
refusal under the button. `useReceiptDownload({ token, order?, onDownload? })`
is the same without the markup.

Without React:

```ts
import {
  classifyReceiptError,
  receiptAvailable,
  saveReceipt,
} from "@bookingbutler/store";

if (receiptAvailable(order)) {
  try {
    const receipt = await client.downloadReceipt(token, {
      orderNumber: order.orderNumber,
    });
    saveReceipt(receipt); // { blob, filename }: a browser download
  } catch (err) {
    show(classifyReceiptError(err).message);
  }
}
```

`filename` is the server's (`Receipt-<orderNumber>.pdf`, from
`Content-Disposition`, which the API exposes to other origins), else
`Receipt-<orderNumber>.pdf` from the `orderNumber` you pass, else
`Receipt.pdf`. Errors are JSON `{error, code}`:

| Status | `classifyReceiptError(e).kind`   | Message                                                          |
| ------ | -------------------------------- | ---------------------------------------------------------------- |
| 404    | `missing`                        | "Receipt not found."                                             |
| 409    | `notPlaced` (`ORDER_NOT_PLACED`) | the checkout was never completed: don't offer it while `pending` |
| 429    | `rateLimited`                    | "Try again in a moment." (10 in a burst, then 1 per 10 s per IP) |
| 503    | `unavailable`                    | "The receipt couldn't be made just now. Try again in a moment."  |
| none   | `network`                        | offline or blocked                                               |

## Rate limits

Every public route is rate-limited per IP address, and a 429 can come from
any of them. Its body is `{error: "rate limit exceeded", message: "Too many
requests. Please try again later."}`. **There is no `Retry-After` header**:
the answer doesn't say how long to wait, so the SDK waits a few seconds.

| Route                                                 | Limit                                      |
| ----------------------------------------------------- | ------------------------------------------ |
| `POST /quote` with `includeTax` or `shippingMethodId` | 20 in a burst, then 1 every 5 s (its own)  |
| `POST /quote` sent as anything but `application/json` | counted against the taxed quote's limit    |
| `GET /orders/{token}/receipt`                         | 10 in a burst, then 1 every 10 s (its own) |
| the other store, order, upload and checkout routes    | their own per-IP limits                    |

What the SDK does about it:

- Every 429 classifies as `rateLimited` with "Too many requests just now.
  Try again in a moment." (`RATE_LIMITED_MESSAGE`); `err.serverMessage` keeps
  the server's sentence.
- The quoters (`createQuoter`, `createShippingQuoter`, and every hook built
  on them) treat a 429 as "not yet": they keep the last figures or options
  (`retrying: true`, and the quote view's `held`), ask again after
  `RATE_LIMIT_RETRY_MS` (5 s), and give up after `RATE_LIMIT_RETRIES` (3)
  tries, failing like any other refusal (with a "Try again" button). A
  change made while waiting is asked for instead, after the usual pause.
- `held` figures are for an older request: show them marked as updating
  (`<Checkout>` dims them, `data-state="updating"`), never as the current total.
- The taxed quote waits longer (`TAXED_QUOTE_DEBOUNCE_MS`, 800 ms), waits
  for the shipping options to answer the address as typed, and never asks
  twice for a request already answered. Every request body is sent as JSON.
- Uploads and receipts don't retry by themselves: their messages say to try
  again in a moment, and `<ReceiptLink>` allows one download at a time.

## API surface

```ts
// @bookingbutler/store
createStoreClient({ storeId, baseUrl?, fetch?, headers? }): StoreClient  // baseUrl defaults to DEFAULT_BASE_URL
  .getStore() .listListings(params) .getListing(id) .uploadFile(file)
  .getShippingOptions(body) .quote(body) .checkout(body) .getOrder(token)
  .downloadReceipt(token, { orderNumber? }) → { blob, filename }
createCart({ storeId, storage?, storageKey?, syncTabs? }): CartStore
  .getSnapshot() .subscribe(fn) .add(line) .setQuantity(i, n) .setSize(i, size)
  .setAnswers(i, answers) .remove(i) .clear() .dispatch(action) .itemCount()
createQuoter({ client, debounceMs?, reuseAnswers?, retryMs?, retries? }): Quoter
  // .update(cart, { checkout?, enabled? }) .view() .subscribe .refetch .cancel
createShippingQuoter({ client, retryMs?, retries? }): ShippingQuoter  // .update(cart, address)
shippingOptionsKey(cart, address)    // what ShippingState.answeredFor is compared with
QUOTE_DEBOUNCE_MS  TAXED_QUOTE_DEBOUNCE_MS  RATE_LIMIT_RETRY_MS  RATE_LIMIT_RETRIES
quoteRequest(cart, checkout?)  checkoutRequest(cart, contact, shipping?)  checkoutLines(cart)
lineFromListing({ listing, option, price, quantity, size, answers })
StoreApiError  classifyError  isAbortError  uploadErrorMessage  createUploader  RATE_LIMITED_MESSAGE
receiptAvailable(order)  receiptFileName(contentDisposition, orderNumber?)  saveReceipt({ blob, filename })
classifyReceiptError  ORDER_NOT_PLACED
formatMoney  priceText  formatRate  formatTier  formatSize  formatLinePricing
cardPriceText  paymentTermsText  quotedTermsText  shippingChargeText
SizeDraft helpers: emptySizeDraft  sizeFromDraft  checkSizeDraft  sizeDraftFrom
redirectToCheckout(url)
// and every API type: Store, Listing, Price, Quote, QuoteLine, Order, Receipt, …
```

Types come from the backend's `swagger.json`, filtered to the public store
routes: `pnpm generate:types [path/to/swagger.json]` rewrites
`src/core/generated/openapi.ts` (the path, or `$BB_SWAGGER`, is required).
This is a maintainers' step: the spec comes from the BookingButler backend.
Commit the result; a contract change then shows up as a type error.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test        # vitest + jsdom
pnpm build       # tsup: ESM + CJS + .d.ts, and dist/styles.css
pnpm format
```

## Releasing

Not automated. To publish a version:

1. Make sure you are on a clean, reviewed commit and logged in to npm as a
   member of the `@bookingbutler` org (`npm whoami`; `npm org ls bookingbutler`).
   The scope must exist on npm before the first publish.
2. Choose the license (`license` in `package.json` is `UNLICENSED` for now).
3. Bump the version: `npm version patch|minor|major` (commits and tags).
4. Check what will ship: `pnpm build && npm pack --dry-run`.
5. Publish: `npm publish` (`publishConfig.access` is `public`;
   `prepublishOnly` runs typecheck, tests and build first). Add
   `--provenance` when publishing from CI.
6. Push the commit and tag: `git push --follow-tags`.
7. Update the CDN version in any vanilla pages that pin it.

## License

[MIT](LICENSE) © Market Leader Technologies
