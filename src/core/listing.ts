import { optionLabel, type CartLine } from "./cart";
import type { FieldDrafts } from "./fieldAnswers";
import type {
  LineSize,
  Listing,
  ListingFile,
  ListingOption,
  Price,
} from "./types";

/*
 * Choosing among a listing's options ("Size: L", "Color: Red"), and turning a
 * choice into a cart line. Options are told apart by their own `id`, not the
 * product's: a product can be listed twice.
 */

type OptionLike = Pick<ListingOption, "options" | "id">;

/** The values each option name takes across a listing's options, first-seen order. */
export function optionValues(
  optionNames: string[],
  options: OptionLike[]
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const name of optionNames) {
    const seen: string[] = [];
    for (const option of options) {
      const value = option.options?.[name];
      if (value != null && !seen.includes(value)) seen.push(value);
    }
    out[name] = seen;
  }
  return out;
}

/**
 * The option a set of choices names. Changing one selector keeps the others
 * where they can be kept: an exact match first, otherwise the first option
 * that has the value just picked.
 */
export function pickOption<T extends OptionLike>(
  options: T[],
  selection: Record<string, string>,
  changed?: string
): T | undefined {
  const matches = (option: T, keys: string[]) =>
    keys.every((key) => option.options?.[key] === selection[key]);
  const keys = Object.keys(selection);
  return (
    options.find((o) => matches(o, keys)) ??
    (changed ? options.find((o) => matches(o, [changed])) : undefined) ??
    options[0]
  );
}

/** Whether a value, with the other choices held, names an option at all. */
export function valueAvailable(
  options: OptionLike[],
  selection: Record<string, string>,
  name: string,
  value: string
): boolean {
  const wanted = { ...selection, [name]: value };
  return options.some((o) =>
    Object.keys(wanted).every((key) => o.options?.[key] === wanted[key])
  );
}

/** The listing's images for a gallery: the option's first, no repeats. */
export function listingImages(
  listing: Listing,
  option?: ListingOption
): ListingFile[] {
  return [
    ...(option?.thumbnail ? [option.thumbnail] : []),
    ...(listing.thumbnail ? [listing.thumbnail] : []),
    ...(listing.files ?? []),
  ].filter(
    (file, i, all) =>
      file.url &&
      file.contentType?.startsWith("image/") &&
      all.findIndex((f) => f.url === file.url) === i
  );
}

/** The listing's documents (anything not an image). */
export const listingDocuments = (listing: Listing): ListingFile[] =>
  (listing.files ?? []).filter(
    (f) => f.url && !f.contentType?.startsWith("image/")
  );

/**
 * A cart line for a listing, its chosen option and price. Only the ids,
 * quantity, size and answers are what checkout sends; the rest is copied for
 * the cart to show. Returns undefined when the price can't be bought.
 */
export function lineFromListing({
  listing,
  option,
  price,
  quantity = 1,
  size,
  answers,
}: {
  listing: Listing;
  option?: ListingOption;
  price: Price;
  quantity?: number;
  size?: LineSize;
  answers?: FieldDrafts;
}): CartLine | undefined {
  if (!listing.id || !price.id || price.cadence) return undefined;
  const form = (option ? option.fields : undefined) ?? listing.fields ?? [];
  const terms = option?.paymentTiming ? option : listing;
  return {
    listingId: listing.id,
    priceId: price.id,
    quantity,
    name: listing.name ?? "Item",
    optionLabel: optionLabel(listing.optionNames ?? [], option?.options),
    unitAmountCents: price.unitAmountCents ?? 0,
    currency: price.currency ?? listing.currency ?? "USD",
    ...((option?.thumbnail?.url ?? listing.thumbnail?.url)
      ? { imageUrl: option?.thumbnail?.url ?? listing.thumbnail?.url }
      : {}),
    ...(option?.id ? { optionId: option.id } : {}),
    ...(form.length > 0 ? { form } : {}),
    ...(answers && Object.keys(answers).length > 0 ? { answers } : {}),
    ...(terms.paymentTiming ? { paymentTiming: terms.paymentTiming } : {}),
    ...(terms.deposit ? { deposit: terms.deposit } : {}),
    ...(price.rate ? { rate: price.rate } : {}),
    ...(size ? { size } : {}),
  };
}
