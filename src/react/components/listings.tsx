"use client";

import { useState, type ReactNode } from "react";
import {
  cadenceLabel,
  cardPriceText,
  cardTermsText,
  listingDocuments,
  MAX_LINE_QUANTITY,
  priceText,
  refusalMessage,
  type CartLine,
  type CartResult,
  type ListListingsParams,
  type Listing,
  type ListingPage,
} from "@bookingbutler/store";
import { useStoreContext } from "../context";
import { useCart, useListingQuote, useLocale } from "../useCart";
import { useListing, useListings } from "../useData";
import {
  useListingSelection,
  type AddResult,
  type ListingSelection,
} from "../useListingSelection";
import {
  cx,
  LineFieldsForm,
  Money,
  RateTable,
  SizeInput,
  Spinner,
} from "./primitives";

// ─── Card and grid ───────────────────────────────────────────────────────────

export interface ListingCardProps {
  listing: Listing;
  /** Where the card links to; defaults to the provider's `paths.listing`. */
  href?: (listing: Listing) => string;
  /** Called on click (after `href` navigation starts, if any). */
  onSelect?: (listing: Listing) => void;
  className?: string;
  /** Heading level for the name. Default 3. */
  headingLevel?: 2 | 3 | 4;
}

/** A listing in a grid: image, name, "From $40", and its payment note. */
export function ListingCard({
  listing,
  href,
  onSelect,
  className,
  headingLevel = 3,
}: ListingCardProps) {
  const { Link, paths } = useStoreContext();
  const locale = useLocale();
  const linkTo = href ?? paths.listing;
  const image =
    listing.thumbnail?.url ??
    listing.files?.find((f) => f.contentType?.startsWith("image/"))?.url;
  const price = cardPriceText(listing, { locale });
  const terms = cardTermsText(listing);
  const Heading = `h${headingLevel}` as const;
  const name = listing.name ?? "Item";
  const body = (
    <>
      <span className="bb-card__media" data-empty={image ? undefined : ""}>
        {image ? <img src={image} alt="" loading="lazy" /> : null}
      </span>
      <span className="bb-card__body">
        <Heading className="bb-card__name">{name}</Heading>
        {price && <span className="bb-card__price">{price}</span>}
        {terms && <span className="bb-card__terms">{terms}</span>}
      </span>
    </>
  );
  return (
    <article className={cx("bb-card", className)} data-listing-id={listing.id}>
      {linkTo ? (
        <Link
          href={linkTo(listing)}
          className="bb-card__link"
          onClick={onSelect ? () => onSelect(listing) : undefined}
        >
          {body}
        </Link>
      ) : onSelect ? (
        <button
          type="button"
          className="bb-card__link"
          onClick={() => onSelect(listing)}
        >
          {body}
        </button>
      ) : (
        <div className="bb-card__link">{body}</div>
      )}
    </article>
  );
}

export interface ListingGridProps {
  /** Search and filters (`q`, `categoryId`, `tagId`, `limit`). */
  params?: ListListingsParams;
  /** The first page, fetched on the server. */
  initialData?: ListingPage;
  href?: (listing: Listing) => string;
  onSelect?: (listing: Listing) => void;
  className?: string;
  /** Draw each card yourself. */
  renderCard?: (listing: Listing) => ReactNode;
  emptyText?: ReactNode;
}

/** The store's listings as a grid, with "Load more" when there are more. */
export function ListingGrid({
  params,
  initialData,
  href,
  onSelect,
  className,
  renderCard,
  emptyText = "Nothing here yet.",
}: ListingGridProps) {
  const result = useListings(params, initialData ? { initialData } : {});
  const state = result.loading
    ? "loading"
    : result.error
      ? "error"
      : result.listings.length === 0
        ? "empty"
        : "ready";
  return (
    <section
      className={cx("bb-listings", className)}
      data-state={state}
      aria-busy={result.loading || undefined}
      aria-label="Listings"
    >
      {result.error ? (
        <div className="bb-alert" role="alert">
          <p>
            {result.notFound ? "This store isn't available." : result.error}
          </p>
          {!result.notFound && (
            <button
              type="button"
              className="bb-button bb-button--secondary"
              onClick={result.refetch}
            >
              Try again
            </button>
          )}
        </div>
      ) : result.loading && result.listings.length === 0 ? (
        <Spinner label="Loading listings" />
      ) : result.listings.length === 0 ? (
        <p className="bb-empty">{emptyText}</p>
      ) : (
        <ul className="bb-grid">
          {result.listings.map((listing) => (
            <li key={listing.id} className="bb-grid__item">
              {renderCard ? (
                renderCard(listing)
              ) : (
                <ListingCard
                  listing={listing}
                  {...(href ? { href } : {})}
                  {...(onSelect ? { onSelect } : {})}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {result.hasMore && (
        <div className="bb-listings__more">
          <button
            type="button"
            className="bb-button bb-button--secondary"
            disabled={result.loadingMore}
            onClick={result.loadMore}
          >
            {result.loadingMore ? "Loading…" : "Load more"}
          </button>
          {result.loadMoreError && (
            <p className="bb-error" role="alert">
              {result.loadMoreError}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Add to cart ─────────────────────────────────────────────────────────────

export interface AddToCartButtonProps {
  /** From `useListingSelection`: checks the size and answers, then adds. */
  selection?: ListingSelection;
  /** Or a ready line (e.g. from `lineFromListing`). */
  line?: CartLine;
  onAdded?: (result: AddResult) => void;
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
}

/** "Add to cart", with what happened said beside it for a ready `line`. */
export function AddToCartButton({
  selection,
  line,
  onAdded,
  className,
  children = "Add to cart",
  disabled,
}: AddToCartButtonProps) {
  const cart = useCart();
  const [status, setStatus] = useState<AddResult | null>(null);
  const uploading = selection?.uploading ?? false;
  const canAdd = selection ? selection.canAdd : Boolean(line);
  const onClick = () => {
    let outcome: AddResult;
    if (selection) outcome = selection.add();
    else if (line) {
      const result: CartResult = cart.add(line);
      outcome = result.ok
        ? { ok: true, result }
        : {
            ok: false,
            message: refusalMessage(result.refusal),
            result,
          };
      setStatus(outcome);
    } else return;
    onAdded?.(outcome);
  };
  return (
    <>
      <button
        type="button"
        className={cx("bb-button", "bb-button--primary", "bb-add", className)}
        disabled={disabled || !canAdd}
        data-state={uploading ? "uploading" : undefined}
        onClick={onClick}
      >
        {uploading ? "Uploading…" : children}
      </button>
      {!selection && status && (
        <span
          className={status.ok ? "bb-status" : "bb-error"}
          role={status.ok ? "status" : "alert"}
        >
          {status.ok ? "Added to your cart." : status.message}
        </span>
      )}
    </>
  );
}

// ─── Listing detail ──────────────────────────────────────────────────────────

/** The server's price for the size and quantity typed (a one-line quote). */
function LinePrice({ s }: { s: ListingSelection }) {
  const quote = useListingQuote({
    ...(s.listing?.id ? { listingId: s.listing.id } : {}),
    ...(s.forSale?.id ? { priceId: s.forSale.id } : {}),
    quantity: s.quantityValid ? s.quantity : 1,
    ...(s.rate ? { rate: s.rate } : {}),
    ...(s.size ? { size: s.size } : {}),
    enabled: Boolean(s.rate) && s.quantityValid && (!s.bySize || !!s.size),
  });
  const currency = quote.quote?.currency ?? s.forSale?.currency;
  if (!s.rate || !s.quantityValid) return null;
  if (s.bySize && !s.size)
    return (
      <p className="bb-line-price bb-hint">Enter the size to see the price.</p>
    );
  const line = quote.line;
  if (line?.amountCents != null)
    return (
      <p className="bb-line-price" role="status" data-state="ready">
        <Money
          cents={line.amountCents}
          currency={currency}
          className="bb-line-price__amount"
        />
        {s.quantity > 1 && line.unitAmountCents != null && (
          <span className="bb-line-price__each">
            {" "}
            for {s.quantity} ·{" "}
            <Money cents={line.unitAmountCents} currency={currency} /> each
          </span>
        )}
      </p>
    );
  const sizeError = quote.sizeErrors?.[0];
  if (sizeError)
    return (
      <p className="bb-line-price bb-error" data-state="error">
        {sizeError}
      </p>
    );
  if (quote.error)
    return (
      <div className="bb-line-price" data-state="error">
        <p className="bb-error" role="alert">
          {quote.error}
        </p>
        <button
          type="button"
          className="bb-button bb-button--secondary"
          onClick={quote.refetch}
        >
          Try again
        </button>
      </div>
    );
  return (
    <p className="bb-line-price bb-hint" data-state="loading">
      Working out the price…
    </p>
  );
}

export interface ListingDetailProps {
  /** The listing to show; or give `listingId` and it is fetched. */
  listing?: Listing;
  listingId?: string;
  /** Where "View cart" links after an add. */
  cartHref?: string;
  /** Where "All listings" links. */
  backHref?: string;
  onAdded?: (result: AddResult) => void;
  className?: string;
}

/**
 * A listing page: images, the price (or rate and its tiers), option choices,
 * the size for a price by size with the server's price for it, the line's
 * form (file uploads included), quantity, and Add to cart.
 */
export function ListingDetail({
  listing: given,
  listingId,
  cartHref,
  backHref,
  onAdded,
  className,
}: ListingDetailProps) {
  const fetched = useListing(given ? null : listingId);
  const listing = given ?? fetched.listing;
  const s = useListingSelection(listing);
  const { Link, paths } = useStoreContext();
  cartHref ??= paths.cart;
  backHref ??= paths.shop;
  const locale = useLocale();
  const [imageIndex, setImageIndex] = useState(0);
  const back = backHref ? (
    <Link href={backHref} className="bb-back">
      All listings
    </Link>
  ) : null;

  if (!listing) {
    const state = fetched.notFound
      ? "missing"
      : fetched.error
        ? "error"
        : "loading";
    return (
      <div className={cx("bb-listing", className)} data-state={state}>
        {back}
        {fetched.notFound ? (
          <p className="bb-empty">This store doesn't show that listing.</p>
        ) : fetched.error ? (
          <div className="bb-alert" role="alert">
            <p>{fetched.error}</p>
            <button
              type="button"
              className="bb-button bb-button--secondary"
              onClick={fetched.refetch}
            >
              Try again
            </button>
          </div>
        ) : (
          <Spinner label="Loading" />
        )}
      </div>
    );
  }

  const images = s.images;
  const image = images[Math.min(imageIndex, Math.max(images.length - 1, 0))];
  const docs = listingDocuments(listing);
  const price = s.price;
  const headingId = `bb-listing-${listing.id}`;

  return (
    <article
      className={cx("bb-listing", className)}
      data-state="ready"
      aria-labelledby={headingId}
    >
      {back}
      <div className="bb-listing__layout">
        <div className="bb-listing__gallery">
          <div
            className="bb-listing__image"
            data-empty={image?.url ? undefined : ""}
          >
            {image?.url && (
              <img
                src={image.url}
                alt={s.selected?.name ?? listing.name ?? ""}
              />
            )}
          </div>
          {images.length > 1 && (
            <div className="bb-listing__thumbs">
              {images.map((file, i) => (
                <button
                  key={file.url}
                  type="button"
                  className="bb-listing__thumb"
                  aria-label={`Image ${i + 1} of ${images.length}`}
                  aria-pressed={i === imageIndex}
                  onClick={() => setImageIndex(i)}
                >
                  <img src={file.url} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="bb-listing__main">
          <h2 id={headingId} className="bb-listing__name">
            {listing.name}
          </h2>
          <p className="bb-listing__price">
            {price ? (
              <>
                {priceText(price, { locale })}
                {price.cadence && (
                  <span className="bb-listing__cadence">
                    {" "}
                    · {cadenceLabel(price.cadence)}
                  </span>
                )}
              </>
            ) : (
              <span className="bb-hint">Unavailable</span>
            )}
          </p>
          {price?.rate && (
            <RateTable rate={price.rate} currency={price.currency} />
          )}
          {s.termsText && (
            <p className="bb-listing__terms">
              {s.termsText}
              {s.refundText && <span className="bb-hint"> {s.refundText}</span>}
            </p>
          )}

          {s.optionNames.map((name) => (
            <fieldset key={name} className="bb-options">
              <legend className="bb-label">{name}</legend>
              <div className="bb-options__values">
                {(s.values[name] ?? []).map((value) => {
                  const active = s.selected?.options?.[name] === value;
                  const available = s.isAvailable(name, value);
                  return (
                    <button
                      key={value}
                      type="button"
                      className="bb-option"
                      aria-pressed={active}
                      data-selected={active ? "" : undefined}
                      data-unavailable={!available && !active ? "" : undefined}
                      onClick={() => s.choose(name, value)}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
          {s.twins.length > 1 && (
            <fieldset className="bb-options">
              <legend className="bb-label">Price</legend>
              <div className="bb-options__values">
                {s.twins.map((option) => {
                  const p = option.prices?.[0];
                  const active = option.id === s.selected?.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className="bb-option"
                      aria-pressed={active}
                      data-selected={active ? "" : undefined}
                      onClick={() => s.chooseOption(option)}
                    >
                      {p
                        ? `${priceText(p, { locale })}${p.cadence ? ` · ${cadenceLabel(p.cadence)}` : ""}`
                        : (option.name ?? "Option")}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {s.form.length > 0 && (
            <fieldset className="bb-listing__form">
              <legend className="bb-label">Your details for this item</legend>
              <LineFieldsForm
                fields={s.form}
                drafts={s.answers}
                onChange={s.setAnswers}
                errors={s.answerErrors}
                onBusyChange={s.setUploading}
                formKey={s.formKey}
                idPrefix={`bb-listing-field-${listing.id}`}
              />
            </fieldset>
          )}

          {s.bySize && s.basis && (
            <SizeInput
              basis={s.basis}
              value={s.sizeDraft}
              onChange={s.setSizeDraft}
              idPrefix={`bb-listing-size-${listing.id}`}
              error={s.sizeError ?? undefined}
            />
          )}
          <LinePrice s={s} />

          <div className="bb-listing__buy">
            <div className="bb-field bb-listing__qty">
              <label className="bb-label" htmlFor={`bb-qty-${listing.id}`}>
                Quantity
              </label>
              <input
                id={`bb-qty-${listing.id}`}
                className="bb-input"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_LINE_QUANTITY}
                step={1}
                value={s.quantityText}
                disabled={!s.forSale}
                aria-invalid={!s.quantityValid || undefined}
                onChange={(e) => s.setQuantityText(e.target.value)}
              />
            </div>
            <AddToCartButton selection={s} {...(onAdded ? { onAdded } : {})} />
          </div>
          {!s.quantityValid && s.forSale && (
            <p className="bb-error">
              Enter a quantity from 1 to {MAX_LINE_QUANTITY}.
            </p>
          )}
          {s.subscriptionOnly && (
            <p className="bb-hint">
              This is sold as a subscription, which can't be bought online here.
            </p>
          )}
          {s.added?.ok && (
            <p className="bb-status" role="status">
              Added to your cart.
              {cartHref && (
                <>
                  {" "}
                  <Link href={cartHref} className="bb-link">
                    View cart
                  </Link>
                </>
              )}
            </p>
          )}
          {s.added && !s.added.ok && (
            <p className="bb-error" role="alert">
              {s.added.message}
            </p>
          )}

          {listing.description && (
            <p className="bb-listing__description">{listing.description}</p>
          )}
          {docs.length > 0 && (
            <ul className="bb-listing__docs">
              {docs.map((file, i) => (
                <li key={file.url}>
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bb-link"
                  >
                    {listing.name} document {i + 1}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}
