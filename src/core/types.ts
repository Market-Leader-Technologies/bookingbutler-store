import type { components, operations, paths } from "./generated/openapi";

/*
 * Readable names for the generated schemas. Everything here is a type alias
 * of `generated/openapi.ts` (regenerate with `pnpm generate:types`), so a
 * contract change shows up as a type error rather than a silent mismatch.
 */

type S = components["schemas"];

export type { components, operations, paths };

export type Store = S["handlers.PublicStoreResponse"];
export type StoreCategory = S["handlers.PublicStoreCategoryResponse"];
export type StoreTag = S["handlers.ProductTagResponse"];
export type Listing = S["handlers.PublicListingResponse"];
export type ListingPage = S["handlers.PublicListingListResponse"];
export type ListingOption = S["handlers.PublicListingOptionResponse"];
export type ListingFile = S["handlers.PublicFileResponse"];
export type Price = S["handlers.PublicPriceResponse"];
export type PricingRate = S["handlers.PricingRate"];
export type PricingTier = S["handlers.PricingTier"];
export type LinePricing = S["handlers.LinePricing"];
export type LineSize = S["LineSize"];
export type Deposit = S["handlers.ListingDepositBody"];
export type FormField = S["handlers.PublicFormFieldResponse"];
export type FieldChoice = S["models.CustomFieldChoice"];

export type CheckoutLineRequest = S["handlers.PublicCheckoutLineRequest"];
export type CheckoutRequest = S["handlers.PublicCheckoutRequest"];
export type QuoteRequest = S["handlers.PublicCartQuoteRequest"];
export type Quote = S["handlers.PublicCartQuoteResponse"];
export type QuoteLine = S["handlers.PublicCartQuoteLine"];
export type ShippingOptionsRequest = S["handlers.PublicShippingOptionsRequest"];
export type ShippingOptions = S["handlers.PublicShippingOptionsResponse"];
export type ShippingOption = S["handlers.PublicShippingOption"];
export type OrderShipping = S["handlers.OrderShippingResponse"];
export type Address = S["models.TaxAddress"];
export type Upload = S["handlers.PublicCheckoutUploadResponse"];
export type Order = S["handlers.PublicOrderResponse"];
/** A line of a shopper's order: the staff line without its cost. */
export type OrderLine = S["handlers.PublicOrderLineItemResponse"];

/** A 400 from any public route: `{error, code?, details?}`. */
export type ValidationErrorBody = S["handlers.ValidationErrorResponse"];
/** A 429 from any public route: `{error: "rate limit exceeded", message}`. */
export type RateLimitedBody = S["handlers.PublicRateLimitedResponse"];
/** The receipt's 409: `{error, code: "ORDER_NOT_PLACED"}`. */
export type ReceiptConflictBody = S["handlers.OrderReceiptConflictResponse"];
/** Any JSON error body the public routes declare (404 and 500 are `{error}`). */
export type StoreErrorBody =
  ValidationErrorBody | RateLimitedBody | ReceiptConflictBody;

export type CurrencyCode = S["models.CurrencyCode"];
export type PaymentTiming = S["models.PaymentTiming"];
export type DepositKind = S["models.DepositKind"];
export type BillingCadence = S["models.BillingCadence"];
export type ShippingMethodKind = S["models.ShippingMethodKind"];
export type CustomFieldType = S["models.CustomFieldType"];
export type PricingBasis = S["pricing.Basis"];
export type PricingUnit = S["pricing.Unit"];
export type PricingTierMode = S["pricing.TierMode"];
export type PricingTierBy = S["pricing.TierBy"];
export type ValidationErrorCode = S["errors.ValidationErrorCode"];
export type OrderPaymentStatus = S["models.OrderPaymentStatus"];

/** `GET /public/stores/{storeId}/listings` query: search, filter and page. */
export type ListListingsParams = NonNullable<
  paths["/api/v1/public/stores/{storeId}/listings"]["get"]["parameters"]["query"]
>;

/** Every shape the SDK knows by its string values (kept beside the types). */
export const PRICING_UNITS = [
  "in",
  "ft",
  "yd",
  "mm",
  "cm",
  "m",
  "oz",
  "lb",
  "ton",
  "g",
  "kg",
  "t",
] as const satisfies readonly PricingUnit[];
export const PRICING_BASES = [
  "quantity",
  "length",
  "area",
  "volume",
  "weight",
] as const satisfies readonly PricingBasis[];
export const PAYMENT_TIMINGS = [
  "full_at_checkout",
  "deposit_at_checkout",
  "invoice_later",
] as const satisfies readonly PaymentTiming[];
export const DEPOSIT_KINDS = [
  "amount",
  "percent",
] as const satisfies readonly DepositKind[];
export const CUSTOM_FIELD_TYPES = [
  "string",
  "number",
  "integer",
  "money",
  "boolean",
  "date",
  "object",
  "single_select",
  "multi_select",
  "multiline",
  "html",
  "url",
  "phone",
  "contact",
  "company",
  "user",
  "address",
  "file",
  "files",
] as const satisfies readonly CustomFieldType[];
