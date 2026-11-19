import { describe, expect, it } from "vitest";
import {
  cardPriceText,
  formatLinePricing,
  formatMoney,
  formatRate,
  formatSize,
  paymentTermsText,
  quotedTermsText,
  shippingChargeText,
} from "@bookingbutler/store";

describe("formatting", () => {
  it("money from minor units", () => {
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
    expect(formatMoney(500, "GBP")).toBe("£5.00");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(1999, "CAD", { locale: "en-CA" })).toBe("$19.99");
  });

  it("rates and tiers as words", () => {
    expect(
      formatRate({
        basis: "area",
        unit: "ft",
        tiers: [{ start: 0, unitAmountCents: 900 }],
      })
    ).toBe("$9.00 / sq ft");
    expect(
      formatRate({
        basis: "quantity",
        minimumCents: 4500,
        tiers: [
          { start: 10, unitAmountCents: 1000 },
          { start: 0, unitAmountCents: 1200 },
        ],
      })
    ).toBe("from $12.00 each, $45.00 minimum");
  });

  it("sizes and a quote line's pricing", () => {
    expect(formatSize({ width: 4, height: 8, unit: "ft" })).toBe("4 × 8 ft");
    expect(formatSize({ amount: 96, basis: "area", unit: "ft" })).toBe(
      "96 sq ft"
    );
    expect(formatSize({ amount: 2, unit: "ton" })).toBe("2 ton");
    expect(
      formatLinePricing({
        basis: "area",
        unit: "ft",
        units: 96,
        tier: { unitAmountCents: 750 },
      })
    ).toBe("96 sq ft at $7.50");
    expect(formatLinePricing({ minimumApplied: true })).toBe("Minimum charge");
  });

  it("payment wording uses the server's figures only", () => {
    expect(
      paymentTermsText({
        paymentTiming: "deposit_at_checkout",
        deposit: { kind: "percent", percentBps: 2500 },
      })
    ).toBe("Pay a 25% deposit today, the rest invoiced later");
    expect(
      quotedTermsText({
        paymentTiming: "deposit_at_checkout",
        dueNowCents: 10000,
        amountCents: 40000,
      })
    ).toBe("Deposit today: $100.00 of $400.00");
    expect(
      cardPriceText({
        fromPriceCents: 4000,
        dueNowFromCents: 2000,
        currency: "USD",
      })
    ).toBe("From $40.00 · $20.00 today");
    expect(shippingChargeText({ chargeCents: 0 })).toBe("Free");
    expect(
      shippingChargeText({ chargeCents: 1500, freeOverCents: 10000 }, "USD")
    ).toBe("$15.00 · free over $100.00");
  });
});
