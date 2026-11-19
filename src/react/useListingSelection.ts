"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buyablePrice,
  carryDrafts,
  defaultUnitForBasis,
  depositRefundText,
  emptySizeDraft,
  isBuyablePrice,
  isBySize,
  lineFromListing,
  listingImages,
  MAX_LINE_QUANTITY,
  optionValues,
  paymentTermsText,
  pickOption,
  refusalMessage,
  sizeFromDraft,
  unitsForBasis,
  validateAnswers,
  type CartResult,
  type FieldDrafts,
  type FieldErrors,
  type FormField,
  type LineSize,
  type Listing,
  type ListingFile,
  type ListingOption,
  type Price,
  type PricingBasis,
  type PricingRate,
  type SizeDraft,
} from "@bookingbutler/store";
import { useCart } from "./useCart";
import { useLocale } from "./useCart";

export type AddResult =
  | { ok: true; result: CartResult }
  | { ok: false; message: string; result?: CartResult };

export interface ListingSelection {
  listing: Listing | undefined;
  optionNames: string[];
  /** Each option name's values, in first-seen order. */
  values: Record<string, string[]>;
  selection: Record<string, string>;
  selected: ListingOption | undefined;
  /** Options with the same choices told apart by price (one product, two prices). */
  twins: ListingOption[];
  /** Pick a value for one option name; the others are kept where they can be. */
  choose(name: string, value: string): void;
  chooseOption(option: ListingOption | undefined): void;
  /** Whether a value, with the other choices held, names an option at all. */
  isAvailable(name: string, value: string): boolean;
  images: ListingFile[];
  /** The price shown: the one-time price for sale, else the first. */
  price: Price | undefined;
  /** The one-time price checkout can buy; undefined for subscription-only. */
  forSale: Price | undefined;
  subscriptionOnly: boolean;
  rate: PricingRate | undefined;
  bySize: boolean;
  basis: PricingBasis | undefined;
  /** The size as typed (half-typed "4." kept). */
  sizeDraft: SizeDraft;
  setSizeDraft(draft: SizeDraft): void;
  /** The size as sent; undefined until it reads as one. */
  size: LineSize | undefined;
  sizeError: string | null;
  quantityText: string;
  setQuantityText(text: string): void;
  quantity: number;
  quantityValid: boolean;
  /** The chosen option's form (or the listing's). */
  form: FormField[];
  answers: FieldDrafts;
  setAnswers(answers: FieldDrafts): void;
  answerErrors: FieldErrors;
  uploading: boolean;
  setUploading(busy: boolean): void;
  /** "Pay a $50.00 deposit per item today…" as the listing words it. */
  termsText: string | undefined;
  refundText: string | undefined;
  canAdd: boolean;
  /** Checks the size and answers, then adds the line to the cart. */
  add(): AddResult;
  /** The last add's outcome, until something changes. */
  added: AddResult | null;
  /** A key that changes with the chosen option, for an upload to tell forms apart. */
  formKey: string;
}

/**
 * Everything a listing page needs to choose an option, a size, a quantity
 * and answers, and add the line: the state `ListingDetail` draws, for a site
 * that draws its own.
 */
export function useListingSelection(
  listing: Listing | undefined
): ListingSelection {
  const cart = useCart();
  const locale = useLocale();
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [optionId, setOptionId] = useState<string | undefined>();
  const [answers, setAnswersState] = useState<FieldDrafts>({});
  const [answerErrors, setAnswerErrors] = useState<FieldErrors>({});
  const [uploading, setUploading] = useState(false);
  const [quantityText, setQuantityTextState] = useState("1");
  const [sizeState, setSizeState] = useState<{
    basis: PricingBasis;
    draft: SizeDraft;
  } | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [added, setAdded] = useState<AddResult | null>(null);

  // A new listing starts over at its first option.
  const listingId = listing?.id;
  useEffect(() => {
    const first = listing?.options?.[0];
    setSelection({ ...(first?.options ?? {}) });
    setOptionId(first?.id);
    setAnswersState({});
    setAnswerErrors({});
    setQuantityTextState("1");
    setSizeState(null);
    setSizeError(null);
    setAdded(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  const optionNames = useMemo(() => listing?.optionNames ?? [], [listing]);
  const options = useMemo(() => listing?.options ?? [], [listing]);
  const values = useMemo(
    () => optionValues(optionNames, options),
    [optionNames, options]
  );
  const selected = options.length
    ? (options.find((o) => o.id && o.id === optionId) ??
      pickOption(options, selection))
    : undefined;
  const twins = selected
    ? options.filter((o) =>
        optionNames.every((n) => o.options?.[n] === selected.options?.[n])
      )
    : [];
  const form =
    (selected ? selected.fields : undefined) ?? listing?.fields ?? [];
  const terms = selected?.paymentTiming ? selected : (listing ?? {});

  const chooseOption = useCallback(
    (option: ListingOption | undefined) => {
      setOptionId(option?.id);
      const nextForm =
        (option ? option.fields : undefined) ?? listing?.fields ?? [];
      setAnswersState((prev) => carryDrafts(nextForm, prev));
      setAnswerErrors({});
      setAdded(null);
      setSizeError(null);
    },
    [listing]
  );

  const choose = useCallback(
    (name: string, value: string) => {
      const next = { ...selection, [name]: value };
      const option = pickOption(options, next, name);
      setSelection({ ...(option?.options ?? next) });
      chooseOption(option);
    },
    [selection, options, chooseOption]
  );

  const forSale = buyablePrice(selected?.prices, cart.currency);
  const price = forSale ?? selected?.prices?.[0];
  const subscriptionOnly = Boolean(price && !isBuyablePrice(price));
  const quantity = Number(quantityText);
  const quantityValid =
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= MAX_LINE_QUANTITY;
  // A size is kept across options priced on the same basis; another basis
  // (or a unit the basis does not take) starts over.
  const rate = forSale?.rate;
  const bySize = isBySize(rate);
  const basis = rate?.basis;
  const rateUnit = rate?.unit ?? defaultUnitForBasis(basis) ?? "ft";
  const sizeDraft: SizeDraft =
    sizeState &&
    rate &&
    sizeState.basis === rate.basis &&
    unitsForBasis(rate.basis).includes(sizeState.draft.unit)
      ? sizeState.draft
      : emptySizeDraft(rateUnit);
  const size =
    bySize && rate ? sizeFromDraft(sizeDraft, rate.basis) : undefined;

  const add = (): AddResult => {
    const fail = (message: string): AddResult => {
      const r: AddResult = { ok: false, message };
      setAdded(r);
      return r;
    };
    if (!listing || !forSale) return fail("This can't be bought online here.");
    if (!quantityValid)
      return fail(`Enter a quantity from 1 to ${MAX_LINE_QUANTITY}.`);
    if (uploading) return fail("Wait for the upload to finish.");
    const errors = validateAnswers(form, answers);
    setAnswerErrors(errors);
    if (bySize && !size) {
      setSizeError("Enter the size you need.");
      return fail("Enter the size before this goes in the cart.");
    }
    setSizeError(null);
    if (Object.keys(errors).length > 0)
      return fail("Some details need fixing before this goes in the cart.");
    const line = lineFromListing({
      listing,
      ...(selected ? { option: selected } : {}),
      price: forSale,
      quantity,
      ...(size ? { size } : {}),
      answers: carryDrafts(form, answers),
    });
    if (!line) return fail("This can't be bought online here.");
    const result = cart.add(line);
    const outcome: AddResult = result.ok
      ? { ok: true, result }
      : { ok: false, message: refusalMessage(result.refusal), result };
    setAdded(outcome);
    if (result.ok) {
      setQuantityTextState("1");
      // The next one gets its own answers: two shirts, two logos.
      setAnswersState({});
    }
    return outcome;
  };

  return {
    listing,
    optionNames,
    values,
    selection,
    selected,
    twins,
    choose,
    chooseOption,
    isAvailable: (name, value) => {
      const wanted = { ...selection, [name]: value };
      return options.some((o) =>
        Object.keys(wanted).every((k) => o.options?.[k] === wanted[k])
      );
    },
    images: listing ? listingImages(listing, selected) : [],
    price,
    forSale,
    subscriptionOnly,
    rate,
    bySize,
    basis,
    sizeDraft,
    setSizeDraft: (draft) => {
      if (rate) setSizeState({ basis: rate.basis, draft });
      setSizeError(null);
      setAdded(null);
    },
    size,
    sizeError,
    quantityText,
    setQuantityText: (text) => {
      setQuantityTextState(text);
      setAdded(null);
    },
    quantity,
    quantityValid,
    form,
    answers,
    setAnswers: (next) => {
      setAnswersState(next);
      setAdded(null);
      if (Object.keys(answerErrors).length)
        setAnswerErrors(validateAnswers(form, next));
    },
    answerErrors,
    uploading,
    setUploading,
    termsText: paymentTermsText(terms, price?.currency, { locale }),
    refundText: depositRefundText(terms),
    canAdd: Boolean(listing && forSale && quantityValid && !uploading),
    add,
    added,
    formKey: `${listing?.id ?? ""}:${selected?.id ?? ""}`,
  };
}
