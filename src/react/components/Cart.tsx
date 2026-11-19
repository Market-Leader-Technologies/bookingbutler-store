"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  answerSummary,
  cartLineKey,
  defaultUnitForBasis,
  formatLinePricing,
  isBySize,
  lineNeedsSize,
  MAX_LINE_QUANTITY,
  paymentTermsText,
  depositRefundText,
  priceText,
  quotedRefundText,
  quotedTermsText,
  refusalMessage,
  sizeDraftFrom,
  sizeFromDraft,
  validateAnswers,
  type CartLine,
  type FieldDrafts,
  type SizeDraft,
} from "@bookingbutler/store";
import { useStoreContext } from "../context";
import {
  useCart,
  useCartQuote,
  useCheckoutFeedback,
  useLocale,
} from "../useCart";
import {
  cx,
  LineFieldsForm,
  Money,
  QuantityStepper,
  RateTable,
  SizeInput,
  Spinner,
} from "./primitives";

/**
 * A stable id per cart row, for its React key and per-row state (a size
 * being typed, an upload in progress). `cartLineKey` moves with every answer
 * or size typed, and a position shifts when a line is removed; a row keeps
 * its id while its key holds, and a changed line takes over the leftover row
 * that bought the same price.
 */
function useRowIds(lines: CartLine[]): string[] {
  const memo = useRef({
    lines: [] as CartLine[],
    ids: [] as string[],
    next: 0,
  });
  const prev = memo.current;
  if (prev.lines === lines) return prev.ids;
  const byKey = new Map(prev.lines.map((l, i) => [cartLineKey(l), i]));
  const taken = new Set<number>();
  const matched = lines.map((l) => {
    const i = byKey.get(cartLineKey(l));
    if (i === undefined || taken.has(i)) return undefined;
    taken.add(i);
    return prev.ids[i];
  });
  let next = prev.next;
  const ids = matched.map((id, index) => {
    if (id) return id;
    const { listingId, priceId } = lines[index]!;
    const j = prev.lines.findIndex(
      (p, i) =>
        !taken.has(i) && p.listingId === listingId && p.priceId === priceId
    );
    if (j >= 0) {
      taken.add(j);
      return prev.ids[j]!;
    }
    return `row-${next++}`;
  });
  memo.current = { lines, ids, next };
  return ids;
}

export interface CartProps {
  /** Where "Check out" goes; leave out when the checkout is on the same page. */
  checkoutHref?: string;
  /** Where "Keep shopping" goes. */
  continueHref?: string;
  className?: string;
  /** Shown when the cart is empty. */
  emptyText?: ReactNode;
  /** Heading text. Default "Your cart". */
  title?: ReactNode;
}

/**
 * The cart: each line with its quantity, size (for a price by size) and
 * details, priced by the server. The subtotal is the quote's; with a line
 * paid by deposit, "Due today" and "Invoiced later" too. Until the quote
 * answers it says it is working one out, and after a failed quote it shows
 * no figures at all.
 */
export function Cart({
  checkoutHref,
  continueHref,
  className,
  emptyText = "Your cart is empty.",
  title = "Your cart",
}: CartProps) {
  const cart = useCart();
  const pricing = useCartQuote();
  const feedback = useCheckoutFeedback();
  const { Link, paths } = useStoreContext();
  checkoutHref ??= paths.checkout;
  continueHref ??= paths.shop;
  const locale = useLocale();
  const [openLines, setOpenLines] = useState<Record<string, boolean>>({});
  const [sizeDrafts, setSizeDrafts] = useState<Record<string, SizeDraft>>({});
  const [lineMessage, setLineMessage] = useState<string | null>(null);
  const { lines } = cart;
  const rowIds = useRowIds(lines);
  const failure = feedback.failure;
  const invalid = failure?.kind === "invalid" ? failure : null;
  const sizesMissing = lines.some(lineNeedsSize);
  const working = !sizesMissing && !pricing.failed;
  const currency = pricing.quote?.currency ?? cart.currency;
  const splitsPayment = (pricing.quote?.lines ?? []).some(
    (l) =>
      l.paymentTiming === "deposit_at_checkout" ||
      l.paymentTiming === "invoice_later"
  );
  const clearLineFailure = (index: number, merged: boolean) => {
    if (invalid && (merged || invalid.lineIndex === index))
      feedback.set({ failure: null });
  };

  const setAnswers = (index: number, line: CartLine, answers: FieldDrafts) => {
    const result = cart.setAnswers(index, answers);
    setLineMessage(result.ok ? null : refusalMessage(result.refusal));
    if (!result.ok) return;
    const key = cartLineKey(line);
    const nextKey = cartLineKey({ ...line, answers });
    setOpenLines((prev) => ({ ...prev, [nextKey]: true }));
    if (feedback.lineErrors[key]) {
      const { [key]: _gone, ...rest } = feedback.lineErrors;
      feedback.set({
        lineErrors: {
          ...rest,
          [nextKey]: validateAnswers(line.form ?? [], answers),
        },
      });
    }
    clearLineFailure(index, result.cart.lines.length < lines.length);
  };

  const setSize = (
    index: number,
    line: CartLine,
    rowId: string,
    draft: SizeDraft
  ) => {
    if (!line.rate) return;
    const size = sizeFromDraft(draft, line.rate.basis);
    const result = cart.setSize(index, size);
    setLineMessage(result.ok ? null : refusalMessage(result.refusal));
    // Refused (a merge past a limit): the row keeps the draft matching the cart.
    if (!result.ok) return;
    setSizeDrafts((prev) => ({ ...prev, [rowId]: draft }));
    const key = cartLineKey(line);
    const { size: _old, ...rest } = line;
    const nextKey = cartLineKey(size ? { ...rest, size } : rest);
    if (key !== nextKey && openLines[key])
      setOpenLines((prev) => ({ ...prev, [nextKey]: true }));
    clearLineFailure(index, result.cart.lines.length < lines.length);
  };

  const setQuantity = (index: number, quantity: number) => {
    const result = cart.setQuantity(index, quantity);
    setLineMessage(result.ok ? null : refusalMessage(result.refusal));
    clearLineFailure(index, false);
  };

  if (lines.length === 0)
    return (
      <section
        className={cx("bb-cart", className)}
        data-state="empty"
        aria-label="Cart"
      >
        <h2 className="bb-cart__title">{title}</h2>
        <p className="bb-empty">{emptyText}</p>
        {continueHref && (
          <Link href={continueHref} className="bb-button bb-button--secondary">
            Keep shopping
          </Link>
        )}
      </section>
    );

  const subtotal = pricing.subtotalCents;
  return (
    <section
      className={cx("bb-cart", className)}
      data-state={
        pricing.failed ? "error" : pricing.quote ? "ready" : "loading"
      }
      aria-labelledby="bb-cart-title"
      aria-busy={pricing.loading || undefined}
    >
      <h2 id="bb-cart-title" className="bb-cart__title">
        {title}
      </h2>
      <ul className="bb-cart__lines">
        {lines.map((line, index) => {
          const rowId = rowIds[index]!;
          const key = cartLineKey(line);
          const flagged = invalid?.lineIndex === index;
          const form = line.form ?? [];
          const fieldErrors = {
            ...feedback.lineErrors[key],
            ...invalid?.lineFields?.[index],
          };
          const hasFieldErrors = Object.keys(fieldErrors).length > 0;
          const open = openLines[key] === true || hasFieldErrors;
          const quoted = pricing.lines[index];
          const bySize = isBySize(line.rate);
          const sizeDraft =
            sizeDrafts[rowId] ??
            sizeDraftFrom(
              line.size,
              line.rate?.unit ?? defaultUnitForBasis(line.rate?.basis) ?? "ft"
            );
          const sizeError =
            invalid?.lineSizes?.[index] ??
            pricing.sizeErrors?.[index] ??
            (lineNeedsSize(line)
              ? "Enter the size you need to see the price."
              : undefined);
          const terms = quoted?.paymentTiming
            ? quotedTermsText(quoted, line.currency, { locale })
            : paymentTermsText(line, line.currency, { locale });
          const refund = quoted?.paymentTiming
            ? quotedRefundText(quoted)
            : depositRefundText(line);
          const breakdown = formatLinePricing(quoted?.pricing, line.currency, {
            locale,
          });
          const summary = form
            .map((field) => ({
              field,
              text: answerSummary(field, line.answers?.[field.fieldKey ?? ""]),
            }))
            .filter((a) => a.text);
          return (
            <li
              key={rowId}
              className="bb-cart__line"
              data-invalid={flagged || hasFieldErrors ? "" : undefined}
              data-state={
                quoted?.amountCents != null
                  ? "priced"
                  : lineNeedsSize(line)
                    ? "needs-size"
                    : "pricing"
              }
            >
              <div className="bb-cart__line-head">
                <span
                  className="bb-cart__thumb"
                  data-empty={line.imageUrl ? undefined : ""}
                >
                  {line.imageUrl && <img src={line.imageUrl} alt="" />}
                </span>
                <div className="bb-cart__line-info">
                  <p className="bb-cart__name">{line.name}</p>
                  {line.optionLabel && (
                    <p className="bb-hint">{line.optionLabel}</p>
                  )}
                  <p className="bb-hint">
                    {line.rate
                      ? priceText(line, { locale })
                      : `${priceText(line, { locale })} each`}
                  </p>
                  {line.rate && (
                    <RateTable rate={line.rate} currency={line.currency} />
                  )}
                  {terms && (
                    <p className="bb-cart__terms">
                      {terms}
                      {refund && <span className="bb-hint"> {refund}</span>}
                    </p>
                  )}
                </div>
              </div>
              {form.length > 0 && (
                <div className="bb-cart__details">
                  {!open && summary.length > 0 && (
                    <dl className="bb-cart__answers">
                      {summary.map(({ field, text }) => (
                        <div key={field.fieldKey}>
                          <dt>{field.name || field.fieldKey}: </dt>
                          <dd>{text}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <button
                    type="button"
                    className="bb-button bb-button--ghost"
                    aria-expanded={open}
                    onClick={() =>
                      setOpenLines((prev) => ({ ...prev, [key]: !open }))
                    }
                  >
                    {open
                      ? "Done"
                      : summary.length > 0
                        ? "Change details"
                        : "Add details"}
                  </button>
                  {open && (
                    <LineFieldsForm
                      fields={form}
                      drafts={line.answers ?? {}}
                      onChange={(answers) => setAnswers(index, line, answers)}
                      errors={fieldErrors}
                      formKey={rowId}
                      idPrefix={`bb-cart-${rowId}`}
                    />
                  )}
                </div>
              )}
              {bySize && line.rate && (
                <SizeInput
                  basis={line.rate.basis}
                  value={sizeDraft}
                  onChange={(next) => setSize(index, line, rowId, next)}
                  idPrefix={`bb-cart-${rowId}-size`}
                  error={sizeError}
                />
              )}
              <div className="bb-cart__line-foot">
                <QuantityStepper
                  value={line.quantity}
                  onChange={(n) => setQuantity(index, n)}
                  name={line.name}
                  max={MAX_LINE_QUANTITY}
                />
                <button
                  type="button"
                  className="bb-button bb-button--ghost bb-cart__remove"
                  aria-label={`Remove ${line.name}`}
                  onClick={() => {
                    cart.remove(index);
                    feedback.set({ failure: null });
                    setLineMessage(null);
                  }}
                >
                  Remove
                </button>
                <span className="bb-cart__amount">
                  {quoted?.amountCents != null ? (
                    <Money
                      cents={quoted.amountCents}
                      currency={line.currency}
                    />
                  ) : working && !lineNeedsSize(line) ? (
                    <Spinner label="Working out the price" />
                  ) : (
                    "—"
                  )}
                  {breakdown && (
                    <span className="bb-hint bb-cart__breakdown">
                      {breakdown}
                    </span>
                  )}
                </span>
              </div>
              {flagged &&
                !invalid?.fieldKey &&
                !invalid?.lineSizes?.[index] && (
                  <p className="bb-error" role="alert">
                    {invalid!.message}
                  </p>
                )}
            </li>
          );
        })}
      </ul>
      {lineMessage && (
        <p className="bb-error" role="alert">
          {lineMessage}
        </p>
      )}
      <dl className="bb-totals">
        <div className="bb-totals__row">
          <dt>Subtotal</dt>
          <dd>
            {subtotal != null ? (
              <Money cents={subtotal} currency={currency} />
            ) : working ? (
              <Spinner label="Working out the subtotal" />
            ) : (
              "—"
            )}
          </dd>
        </div>
        {pricing.quote && splitsPayment && (
          <>
            <div className="bb-totals__row">
              <dt>Due today</dt>
              <dd>
                <Money cents={pricing.quote.dueNowCents} currency={currency} />
              </dd>
            </div>
            <div className="bb-totals__row">
              <dt>Invoiced later</dt>
              <dd>
                <Money cents={pricing.quote.balanceCents} currency={currency} />
              </dd>
            </div>
          </>
        )}
        <div className="bb-totals__row bb-totals__row--note">
          <dt>Total</dt>
          <dd>Tax and delivery at checkout</dd>
        </div>
      </dl>
      {pricing.error && (
        <div className="bb-alert" role="alert">
          <p>{pricing.error}</p>
          <button
            type="button"
            className="bb-button bb-button--secondary"
            onClick={pricing.refetch}
          >
            Try again
          </button>
        </div>
      )}
      {sizesMissing && (
        <p className="bb-hint">
          Every item priced by size needs its size before checkout.
        </p>
      )}
      <div className="bb-cart__actions">
        {continueHref && (
          <Link href={continueHref} className="bb-button bb-button--secondary">
            Keep shopping
          </Link>
        )}
        {checkoutHref && (
          <Link href={checkoutHref} className="bb-button bb-button--primary">
            Check out
          </Link>
        )}
      </div>
    </section>
  );
}
