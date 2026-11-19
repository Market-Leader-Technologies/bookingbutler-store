"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addressIncomplete,
  cartLineKey,
  cartLineName,
  checkoutRequest,
  classifyError,
  EMAIL_SHAPE,
  EMPTY_ADDRESS,
  isDelivered,
  lineNeedsSize,
  redirectToCheckout,
  validateAnswers,
  type Address,
  type CheckoutContact,
  type CheckoutField,
  type CheckoutShipping,
  type FieldErrors,
  type Order,
  type ShippingOption,
  type StoreFailure,
} from "@bookingbutler/store";
import { useStoreContext } from "./context";
import {
  useCart,
  useCartQuote,
  useCheckoutFeedback,
  useCheckoutQuote,
  useShippingOptions,
  type CartQuoteResult,
  type ShippingOptionsResult,
} from "./useCart";

export interface UseCheckoutOptions {
  /**
   * Called with the pay page's URL instead of redirecting (analytics first,
   * or a custom transition). Redirect yourself with `redirectToCheckout`.
   */
  onCheckout?: (checkoutUrl: string, order: Order) => void;
  initialContact?: Partial<CheckoutContact>;
}

type ContactDraft = Required<CheckoutContact>;

export interface UseCheckoutResult {
  contact: ContactDraft;
  setContact(field: keyof CheckoutContact, value: string): void;
  address: Address;
  setAddress(field: keyof Address, value: string): void;
  shipping: ShippingOptionsResult;
  /** The options to choose from (empty at a store with no delivery). */
  options: ShippingOption[];
  /** The chosen option; a single option is chosen by itself. */
  chosen: ShippingOption | undefined;
  chooseMethod(methodId: string): void;
  /** The chosen option brings the order to an address. */
  delivered: boolean;
  /** Delivery is chosen (and addressed, for a delivery): the total can be worked out. */
  deliveryReady: boolean;
  /** The last ask for the options failed; checkout waits for a retry. */
  shippingFailed: boolean;
  /** The delivery as checkout and the taxed quote send it. */
  deliveryChoice: CheckoutShipping | undefined;
  /** The cart's goods-only quote (shared with the cart). */
  goods: CartQuoteResult;
  /** The checkout step's quote: shipping, tax, total, due today. */
  taxed: CartQuoteResult;
  sizesMissing: boolean;
  /** What to say beside a field, after a submit or a refusal. */
  fieldError(field: CheckoutField): string | undefined;
  /** Hand to a field's `ref`, so a refusal can focus it. */
  fieldRef(field: CheckoutField): (el: HTMLElement | null) => void;
  failure: StoreFailure | null;
  /** A refusal that names no field or line, to say near the button. */
  generalFailure: StoreFailure | null;
  /** The store has closed (from any quote or the checkout). */
  closed: StoreFailure | undefined;
  /** Answers that need fixing, by cart line key. */
  lineErrors: Record<string, FieldErrors>;
  submitting: boolean;
  canSubmit: boolean;
  /** Validates, makes the order, empties the cart and goes to the pay page. */
  submit(): Promise<Order | undefined>;
}

/**
 * The checkout form's state and rules, for `<Checkout>` or a page of your
 * own. The figures are the server's: the taxed quote is asked only once
 * delivery is chosen (and addressed), and `includeTax` is never sent before.
 * Submitting sends `{listingId, priceId, quantity, size?, fields?}` lines,
 * never amounts, then redirects to the returned `checkoutUrl`.
 */
export function useCheckout({
  onCheckout,
  initialContact,
}: UseCheckoutOptions = {}): UseCheckoutResult {
  const { client } = useStoreContext();
  const cart = useCart();
  const feedback = useCheckoutFeedback();
  const [contact, setContactState] = useState<ContactDraft>({
    name: "",
    email: "",
    phone: "",
    note: "",
    ...initialContact,
  });
  const [address, setAddressState] = useState<Address>(EMPTY_ADDRESS);
  const [methodId, setMethodId] = useState<string | undefined>();
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const refs = useRef<Partial<Record<CheckoutField, HTMLElement>>>({});
  const { lines } = cart;
  const failure = feedback.failure;
  const setFailure = useCallback(
    (f: StoreFailure | null) => feedback.set({ failure: f }),
    [feedback.set]
  );

  const shipping = useShippingOptions({ address });
  const goods = useCartQuote();
  const configured = shipping.configured === true;
  const shippingFailed =
    shipping.error != null && shipping.configured !== false;
  const options = configured ? shipping.options : [];
  const chosen =
    options.find((o) => o.methodId === methodId) ??
    (options.length === 1 ? options[0] : undefined);
  const delivered = isDelivered(chosen);
  const incomplete = addressIncomplete(address);
  const deliveryChoice: CheckoutShipping | undefined =
    configured && chosen?.methodId
      ? { methodId: chosen.methodId, ...(delivered ? { address } : {}) }
      : undefined;
  // A store with no methods is a pickup: chosen already. A delivery also
  // waits for a complete address. The server says ADDRESS_REQUIRED for a
  // missing one and FIELD_VALIDATION_ERROR for a partial one, but each such
  // refusal of a taxed quote spends the taxed quote's own rate limit (20 in
  // a burst, then 1 every 5 s), so a half-typed address is never sent.
  const deliveryReady =
    shipping.configured === false ||
    (deliveryChoice != null && !(delivered && incomplete));
  // A delivery's tax is asked only once the options have answered for the
  // address as typed now: while the shopper types, the options are asked
  // again (after a pause) and the taxed quote waits for them, then waits
  // longer still, so typing an address sends one taxed quote, not one per
  // pause. A pickup sends no address, so its quote need not wait.
  const shippingSettled =
    shipping.configured === false || !delivered || shipping.current;
  const taxed = useCheckoutQuote({
    ...(deliveryChoice ? { shipping: deliveryChoice } : {}),
    enabled:
      deliveryReady && shippingSettled && !shippingFailed && lines.length > 0,
  });
  const sizesMissing = lines.some(lineNeedsSize);
  const nameMissing = contact.name.trim() === "";
  const emailInvalid = !EMAIL_SHAPE.test(contact.email.trim());

  const refetchShipping = shipping.refetch;
  useEffect(() => {
    // The method no longer reaches this cart or address: say so on the
    // choice and ask for the options again, as a refused checkout does.
    const refused = taxed.failure;
    if (refused?.kind === "invalid" && refused.refetchShipping) {
      setFailure(refused);
      setMethodId(undefined);
      refetchShipping();
    } else if (
      refused?.kind === "invalid" &&
      (refused.needsShipping || refused.needsAddress)
    ) {
      // DELIVERY_METHOD_REQUIRED: say so on the choice. ADDRESS_REQUIRED:
      // keep the choice and ask for the address, on the address.
      setFailure(refused);
    }
  }, [taxed.failure, refetchShipping, setFailure]);

  useEffect(() => {
    if (
      failure?.kind === "invalid" &&
      failure.field &&
      failure.field !== "lines"
    )
      refs.current[failure.field]?.focus();
  }, [failure]);

  const fieldError = (field: CheckoutField): string | undefined => {
    if (touched && field === "name" && nameMissing) return "Enter your name.";
    if (touched && field === "email" && emailInvalid)
      return contact.email.trim()
        ? "Enter an email address like you@example.com."
        : "Enter your email: the receipt goes there.";
    // The server's word stands over the local check: it says why.
    if (failure?.kind === "invalid" && failure.field === field)
      return failure.message;
    if (touched && field === "shipping" && configured && !chosen)
      return "Choose how the order gets to you.";
    if (touched && field === "address" && delivered && incomplete)
      return "Enter the street, the city, and the state or postal code.";
    return undefined;
  };

  const setContact = (field: keyof CheckoutContact, value: string) => {
    setContactState((prev) => ({ ...prev, [field]: value }));
    if (failure?.kind === "invalid" && failure.field === field)
      setFailure(null);
  };
  const setAddress = (field: keyof Address, value: string) => {
    setAddressState((prev) => ({ ...prev, [field]: value }));
    if (
      failure?.kind === "invalid" &&
      (failure.field === "address" || failure.field === "shipping")
    )
      setFailure(null);
  };
  const chooseMethod = (id: string) => {
    setMethodId(id);
    if (
      failure?.kind === "invalid" &&
      (failure.field === "shipping" || failure.field === "address")
    )
      setFailure(null);
  };

  const placed =
    failure?.kind === "invalid" &&
    (failure.lineIndex != null ||
      (failure.field != null && failure.field !== "lines"));
  const closed = [failure, goods.failure, taxed.failure].find(
    (f): f is StoreFailure => f?.kind === "closed"
  );
  // The checkout would be refused as the taxed quote was.
  const refusedOutright = [failure, taxed.failure].some(
    (f) => f?.kind === "notTaking" || f?.kind === "nothingToPay"
  );

  const submit = async (): Promise<Order | undefined> => {
    setTouched(true);
    if (submitting) return undefined;
    const lineErrors: Record<string, FieldErrors> = {};
    for (const line of lines) {
      const errors = validateAnswers(line.form ?? [], line.answers ?? {});
      if (Object.keys(errors).length) lineErrors[cartLineKey(line)] = errors;
    }
    feedback.set({ lineErrors });
    const answersBad = Object.keys(lineErrors).length > 0;
    if (answersBad)
      setFailure({
        kind: "other",
        message: "Some items need their details filled in before checkout.",
      });
    const shippingMissing = configured && !chosen;
    const addressMissing = configured && delivered && incomplete;
    if (
      answersBad ||
      sizesMissing ||
      nameMissing ||
      emailInvalid ||
      lines.length === 0 ||
      shippingFailed ||
      shippingMissing ||
      addressMissing
    ) {
      if (nameMissing || emailInvalid)
        refs.current[nameMissing ? "name" : "email"]?.focus();
      else if (shippingMissing) refs.current.shipping?.focus();
      else if (addressMissing) refs.current.address?.focus();
      return undefined;
    }
    setSubmitting(true);
    setFailure(null);
    try {
      const order = await client.checkout(
        checkoutRequest(cart.cart, contact, deliveryChoice)
      );
      const url = order.checkoutUrl;
      if (!url) {
        setFailure({
          kind: "other",
          message: "The order was made but its payment page wasn't. Try again.",
        });
        return order;
      }
      // The order holds the cart now; a cart left full invites a second order.
      cart.clear();
      if (onCheckout) onCheckout(url, order);
      else redirectToCheckout(url);
      return order;
    } catch (err) {
      const refused = classifyError(err, {
        lineNames: lines.map(cartLineName),
      });
      setFailure(refused);
      // ADDRESS_REQUIRED keeps the delivery choice: only the address is missing.
      if (refused.kind === "invalid" && refused.refetchShipping) {
        setMethodId(undefined);
        refetchShipping();
      }
      return undefined;
    } finally {
      setSubmitting(false);
    }
  };

  return {
    contact,
    setContact,
    address,
    setAddress,
    shipping,
    options,
    chosen,
    chooseMethod,
    delivered,
    deliveryReady,
    shippingFailed,
    deliveryChoice,
    goods,
    taxed,
    sizesMissing,
    fieldError,
    fieldRef: (field) => (el) => {
      if (el) refs.current[field] = el;
    },
    failure,
    generalFailure: failure && !placed ? failure : null,
    closed,
    lineErrors: feedback.lineErrors,
    submitting,
    canSubmit:
      !submitting &&
      lines.length > 0 &&
      !refusedOutright &&
      closed == null &&
      !shippingFailed &&
      !(shipping.loading && !shipping.data),
    submit,
  };
}
