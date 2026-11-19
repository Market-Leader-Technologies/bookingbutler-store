"use client";

import { useId, type ReactNode } from "react";
import {
  cartLineName,
  shippingChargeText,
  type Address,
  type CurrencyCode,
  type Order,
  type Quote,
  type ShippingOption,
} from "@bookingbutler/store";
import { useStoreContext } from "../context";
import { useCart, useLocale, type CartQuoteResult } from "../useCart";
import { useCheckout, type UseCheckoutResult } from "../useCheckout";
import { cx, Money, Spinner } from "./primitives";

const ADDRESS_FIELDS: {
  key: keyof Address;
  label: string;
  autoComplete: string;
  optional?: boolean;
  wide?: boolean;
}[] = [
  {
    key: "street1",
    label: "Street",
    autoComplete: "address-line1",
    wide: true,
  },
  {
    key: "street2",
    label: "Apartment, suite",
    autoComplete: "address-line2",
    optional: true,
    wide: true,
  },
  { key: "city", label: "City", autoComplete: "address-level2" },
  { key: "state", label: "State", autoComplete: "address-level1" },
  { key: "postalCode", label: "Postal code", autoComplete: "postal-code" },
  { key: "country", label: "Country", autoComplete: "country", optional: true },
];

export interface CheckoutProps {
  /** Instead of redirecting to the pay page (it is yours to redirect then). */
  onCheckout?: (checkoutUrl: string, order: Order) => void;
  /** Where "Edit cart" links in the order summary. */
  cartHref?: string;
  className?: string;
  /** The button's text. Default "Continue to payment". */
  submitLabel?: ReactNode;
  /** Draw the order summary (lines and their amounts). Default true. */
  showSummary?: boolean;
}

/**
 * The checkout form: delivery (options for the cart and address), contact,
 * and the server's totals. The total is quoted with `includeTax` only once
 * delivery is chosen and addressed; until then it says what it needs.
 * "Continue to payment" makes the order and sends the shopper to its hosted
 * pay page; the cart is emptied then.
 */
export function Checkout({
  onCheckout,
  cartHref,
  className,
  submitLabel = "Continue to payment",
  showSummary = true,
}: CheckoutProps) {
  const c = useCheckout(onCheckout ? { onCheckout } : {});
  const cart = useCart();
  const { Link, paths } = useStoreContext();
  cartHref ??= paths.cart;
  const uid = useId().replace(/:/g, "");
  const id = (name: string) => `bb-co-${uid}-${name}`;

  if (cart.isEmpty)
    return (
      <section
        className={cx("bb-checkout", className)}
        data-state="empty"
        aria-label="Checkout"
      >
        <p className="bb-empty">
          Your cart is empty. Add something to check out.
        </p>
      </section>
    );

  const currency =
    c.taxed.quote?.currency ?? c.goods.quote?.currency ?? cart.currency;
  const state = c.submitting
    ? "submitting"
    : c.closed
      ? "closed"
      : c.taxed.quote?.complete
        ? "ready"
        : "pending";

  return (
    <form
      className={cx("bb-checkout", className)}
      data-state={state}
      noValidate
      aria-labelledby={id("title")}
      onSubmit={(e) => {
        e.preventDefault();
        void c.submit();
      }}
    >
      <h2 id={id("title")} className="bb-checkout__title">
        Checkout
      </h2>

      {showSummary && (
        <OrderSummary
          c={c}
          currency={currency}
          cartHref={cartHref}
          Link={Link}
        />
      )}

      {c.shipping.configured !== false && (
        <Delivery
          c={c}
          id={id}
          currency={c.shipping.data?.currency ?? currency}
        />
      )}

      <fieldset className="bb-checkout__contact">
        <legend className="bb-legend">Your details</legend>
        <ContactField
          c={c}
          field="name"
          id={id("name")}
          label="Name"
          autoComplete="name"
        />
        <ContactField
          c={c}
          field="email"
          id={id("email")}
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          hint="Your receipt is sent here."
        />
        <ContactField
          c={c}
          field="phone"
          id={id("phone")}
          label="Phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          optional
        />
        <ContactField
          c={c}
          field="note"
          id={id("note")}
          label="Note for the shop"
          optional
          multiline
        />
      </fieldset>

      <CheckoutTotals c={c} currency={currency} />

      {c.closed && c.failure?.kind !== "closed" && (
        <p className="bb-alert" role="alert">
          {c.closed.message}
        </p>
      )}
      {c.generalFailure && (
        <div className="bb-alert" role="alert">
          <p>{c.generalFailure.message}</p>
          {c.generalFailure.kind === "tax" && (
            <button
              type="button"
              className="bb-button bb-button--secondary"
              disabled={c.submitting}
              onClick={() => void c.submit()}
            >
              Try again
            </button>
          )}
        </div>
      )}

      <button
        type="submit"
        className="bb-button bb-button--primary bb-checkout__submit"
        disabled={!c.canSubmit}
        aria-busy={c.submitting || undefined}
      >
        {c.submitting ? "Going to payment…" : submitLabel}
      </button>
    </form>
  );
}

function OrderSummary({
  c,
  currency,
  cartHref,
  Link,
}: {
  c: UseCheckoutResult;
  currency: CurrencyCode | undefined;
  cartHref: string | undefined;
  Link: ReturnType<typeof useStoreContext>["Link"];
}) {
  const { lines } = useCart();
  // The taxed quote's lines when it is current, else the cart quote's.
  const quoted: CartQuoteResult = c.taxed.quote ? c.taxed : c.goods;
  const invalid = c.failure?.kind === "invalid" ? c.failure : null;
  return (
    <section className="bb-summary" aria-label="Order summary">
      <ul className="bb-summary__lines">
        {lines.map((line, i) => {
          const amount = quoted.lines[i]?.amountCents;
          const flagged = invalid?.lineIndex === i;
          return (
            <li
              key={i}
              className="bb-summary__line"
              data-invalid={flagged ? "" : undefined}
            >
              <span className="bb-summary__name">
                {cartLineName(line)} × {line.quantity}
              </span>
              <span className="bb-summary__amount">
                {amount != null ? (
                  <Money cents={amount} currency={currency} />
                ) : (
                  "—"
                )}
              </span>
              {flagged && (
                <span className="bb-error" role="alert">
                  {invalid!.message}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {cartHref && (
        <Link href={cartHref} className="bb-link">
          Edit cart
        </Link>
      )}
    </section>
  );
}

function ContactField({
  c,
  field,
  id,
  label,
  type = "text",
  inputMode,
  autoComplete,
  hint,
  optional,
  multiline,
}: {
  c: UseCheckoutResult;
  field: "name" | "email" | "phone" | "note";
  id: string;
  label: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  hint?: string;
  optional?: boolean;
  multiline?: boolean;
}) {
  const error = c.fieldError(field);
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const common = {
    id,
    className: multiline ? "bb-input bb-textarea" : "bb-input",
    value: c.contact[field],
    disabled: c.submitting,
    "aria-invalid": Boolean(error) || undefined,
    "aria-describedby": describedBy,
    ref: c.fieldRef(field),
  };
  return (
    <div className="bb-field" data-invalid={error ? "" : undefined}>
      <label className="bb-label" htmlFor={id}>
        {label}
        {optional && <span className="bb-optional"> (optional)</span>}
      </label>
      {multiline ? (
        <textarea
          {...common}
          rows={3}
          maxLength={1000}
          onChange={(e) => c.setContact(field, e.target.value)}
        />
      ) : (
        <input
          {...common}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          maxLength={255}
          required={!optional}
          onChange={(e) => c.setContact(field, e.target.value)}
        />
      )}
      {error ? (
        <p id={`${id}-error`} className="bb-error">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="bb-hint">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

function Delivery({
  c,
  id,
  currency,
}: {
  c: UseCheckoutResult;
  id: (name: string) => string;
  currency: CurrencyCode | undefined;
}) {
  const locale = useLocale();
  const addressError = c.fieldError("address");
  const choiceError = c.fieldError("shipping");
  const { shipping } = c;
  const initialLoading = shipping.loading && !shipping.data;
  return (
    <fieldset
      className="bb-delivery"
      aria-busy={shipping.loading || undefined}
      data-state={
        initialLoading ? "loading" : shipping.error ? "error" : "ready"
      }
    >
      <legend className="bb-legend">Delivery</legend>
      <div className="bb-address">
        {ADDRESS_FIELDS.map((f) => {
          const fid = id(`address-${f.key}`);
          return (
            <div
              key={f.key}
              className={cx("bb-field", f.wide && "bb-field--wide")}
            >
              <label className="bb-label" htmlFor={fid}>
                {f.label}
                {f.optional && <span className="bb-optional"> (optional)</span>}
              </label>
              <input
                id={fid}
                className="bb-input"
                ref={f.key === "street1" ? c.fieldRef("address") : undefined}
                autoComplete={f.autoComplete}
                value={c.address[f.key] ?? ""}
                maxLength={f.key === "country" ? 2 : 255}
                placeholder={f.key === "country" ? "US" : undefined}
                disabled={c.submitting}
                aria-invalid={
                  (Boolean(addressError) && !f.optional) || undefined
                }
                aria-describedby={
                  addressError && !f.optional ? id("address-error") : undefined
                }
                onChange={(e) => c.setAddress(f.key, e.target.value)}
              />
            </div>
          );
        })}
      </div>
      {addressError ? (
        <p id={id("address-error")} className="bb-error">
          {addressError}
        </p>
      ) : (
        <p className="bb-hint">
          {c.delivered
            ? "Delivery needs the full address."
            : c.address.postalCode?.trim()
              ? "Pickup needs no address."
              : "Enter a postal code to see delivery options. Pickup needs no address."}
        </p>
      )}

      {initialLoading ? (
        <Spinner label="Getting delivery options" />
      ) : shipping.error ? (
        <div className="bb-alert" role="alert">
          <p>{shipping.error}</p>
          <button
            type="button"
            className="bb-button bb-button--secondary"
            disabled={c.submitting}
            onClick={shipping.refetch}
          >
            Try again
          </button>
        </div>
      ) : c.options.length === 0 ? (
        <p className="bb-hint">
          No way to get the order to this address. Check the postal code, or
          enter the full address.
        </p>
      ) : (
        <div
          className="bb-methods"
          role="radiogroup"
          aria-label="How the order gets to you"
          aria-invalid={Boolean(choiceError) || undefined}
          aria-describedby={choiceError ? id("shipping-error") : undefined}
        >
          {c.options.map((option: ShippingOption, i) => {
            const on = c.chosen?.methodId === option.methodId;
            const oid = id(`method-${i}`);
            return (
              <label
                key={option.methodId ?? i}
                className="bb-method"
                htmlFor={oid}
                data-selected={on ? "" : undefined}
              >
                <input
                  id={oid}
                  ref={i === 0 ? c.fieldRef("shipping") : undefined}
                  className="bb-radio"
                  type="radio"
                  name={id("method")}
                  value={option.methodId}
                  checked={on}
                  disabled={c.submitting || !option.methodId}
                  onChange={() =>
                    option.methodId && c.chooseMethod(option.methodId)
                  }
                />
                <span className="bb-method__text">
                  <span className="bb-method__name">{option.name}</span>
                  {option.description && (
                    <span className="bb-hint">{option.description}</span>
                  )}
                  <span className="bb-method__charge">
                    {shippingChargeText(option, currency, { locale })}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
      {choiceError && (
        <p id={id("shipping-error")} className="bb-error">
          {choiceError}
        </p>
      )}
    </fieldset>
  );
}

/**
 * The checkout step's figures, all from the taxed quote: goods, delivery,
 * tax, total and due today. When `complete`, they are what POST /checkout
 * will charge. On a 503 (tax unavailable) the goods and the delivery are
 * shown without a total, and the checkout works the tax out again.
 */
function CheckoutTotals({
  c,
  currency,
}: {
  c: UseCheckoutResult;
  currency: CurrencyCode | undefined;
}) {
  const { taxed, goods } = c;
  const quote = taxed.quote;
  const refused = taxed.failure;
  if (refused?.kind === "closed") return null;
  const methodGone = refused?.kind === "invalid" && refused.refetchShipping;
  let body: ReactNode;
  let state = "pending";
  if (c.sizesMissing)
    body = <p className="bb-hint">Enter every size to see the total.</p>;
  else if (!c.deliveryReady || methodGone)
    body = (
      <p className="bb-hint">
        {c.delivered
          ? "Enter the delivery address to see the total."
          : "Choose how the order gets to you to see the total."}
      </p>
    );
  else if (refused?.kind === "notTaking" || refused?.kind === "nothingToPay") {
    state = "error";
    body = (
      <p className="bb-alert" role="alert">
        {refused.message}
      </p>
    );
  } else if (quote) {
    state = quote.complete ? "complete" : "partial";
    body = <TotalsFigures quote={quote} currency={currency} />;
  } else if (taxed.held) {
    // A 429: the last figures, marked as updating, until it is asked again.
    state = "updating";
    body = (
      <>
        <div className="bb-totals--held" aria-hidden="true">
          <TotalsFigures quote={taxed.held} currency={currency} />
        </div>
        <p className="bb-status" role="status">
          Busy just now. Updating the total in a few seconds…
        </p>
      </>
    );
  } else if (refused?.kind === "tax") {
    state = "tax-unavailable";
    body = (
      <>
        <dl className="bb-totals">
          <Row
            label="Subtotal"
            cents={goods.subtotalCents}
            currency={currency}
          />
          {c.chosen && (
            <div className="bb-totals__row">
              <dt>{c.chosen.name || "Delivery"}</dt>
              <dd>
                {c.chosen.chargeCents ? (
                  <Money cents={c.chosen.chargeCents} currency={currency} />
                ) : (
                  "Free"
                )}
              </dd>
            </div>
          )}
        </dl>
        <p className="bb-status" role="status">
          Tax will be added at payment.
        </p>
      </>
    );
  } else if (taxed.failed && !taxed.loading) {
    state = "error";
    body = (
      <div className="bb-alert" role="alert">
        <p>
          {taxed.error && taxed.error !== goods.error
            ? taxed.error
            : "We couldn't work out the total."}
        </p>
        <button
          type="button"
          className="bb-button bb-button--secondary"
          onClick={taxed.refetch}
        >
          Try again
        </button>
      </div>
    );
  } else {
    state = "loading";
    body = <p className="bb-hint">Working out the total…</p>;
  }
  return (
    <section
      className="bb-checkout__totals"
      aria-label="Order total"
      aria-busy={taxed.loading || undefined}
      data-state={state}
    >
      {body}
    </section>
  );
}

function TotalsFigures({
  quote,
  currency,
}: {
  quote: Quote;
  currency: CurrencyCode | undefined;
}) {
  const cur = quote.currency ?? currency;
  return (
    <>
      <dl className="bb-totals">
        <Row label="Subtotal" cents={quote.subtotalCents} currency={cur} />
        {quote.shipping && (
          <div className="bb-totals__row">
            <dt>{quote.shipping.name || "Delivery"}</dt>
            <dd>
              {quote.shipping.chargeCents ? (
                <Money cents={quote.shipping.chargeCents} currency={cur} />
              ) : (
                "Free"
              )}
            </dd>
          </div>
        )}
        <div className="bb-totals__row">
          <dt>Tax</dt>
          <dd>
            {quote.complete && quote.taxCents != null ? (
              <Money cents={quote.taxCents} currency={cur} />
            ) : (
              "Added at payment"
            )}
          </dd>
        </div>
        <Row
          label={quote.complete ? "Total" : "Total before tax"}
          cents={quote.totalCents}
          currency={cur}
          strong
        />
        <Row
          label="Due today"
          cents={quote.dueNowCents}
          currency={cur}
          strong
        />
        {(quote.balanceCents ?? 0) > 0 && (
          <Row
            label="Invoiced later"
            cents={quote.balanceCents}
            currency={cur}
          />
        )}
      </dl>
      {quote.taxNote && (
        <p className="bb-hint bb-totals__note">{quote.taxNote}</p>
      )}
    </>
  );
}

function Row({
  label,
  cents,
  currency,
  strong,
}: {
  label: string;
  cents: number | undefined;
  currency: CurrencyCode | string | undefined;
  strong?: boolean;
}) {
  return (
    <div className={cx("bb-totals__row", strong && "bb-totals__row--strong")}>
      <dt>{label}</dt>
      <dd>
        <Money cents={cents} currency={currency} />
      </dd>
    </div>
  );
}
