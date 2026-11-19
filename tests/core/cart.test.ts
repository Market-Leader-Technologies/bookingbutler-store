import { describe, expect, it } from "vitest";
import {
  applyCartAction,
  cartStorageKey,
  createCart,
  EMPTY_CART,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  parseStoredCart,
  type CartStorage,
} from "@bookingbutler/store";
import { bySizeLine, line } from "../helpers";

const memoryStorage = () => {
  const data = new Map<string, string>();
  const storage: CartStorage & { data: Map<string, string> } = {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
  return storage;
};

describe("cart rules", () => {
  it("merges an add of the same price, size and answers into one line", () => {
    let cart = applyCartAction(EMPTY_CART, {
      type: "add",
      line: line({ quantity: 2 }),
    }).cart;
    const r = applyCartAction(cart, {
      type: "add",
      line: line({ quantity: 3 }),
    });
    expect(r.ok).toBe(true);
    cart = r.cart;
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]!.quantity).toBe(5);
  });

  it("keeps different answers and different sizes as separate lines", () => {
    let cart = EMPTY_CART;
    cart = applyCartAction(cart, {
      type: "add",
      line: line({ answers: { logo: "A" } }),
    }).cart;
    cart = applyCartAction(cart, {
      type: "add",
      line: line({ answers: { logo: "B" } }),
    }).cart;
    cart = applyCartAction(cart, {
      type: "add",
      line: bySizeLine({ size: { amount: 12, basis: "area", unit: "ft" } }),
    }).cart;
    cart = applyCartAction(cart, {
      type: "add",
      line: bySizeLine({ size: { amount: 32, basis: "area", unit: "ft" } }),
    }).cart;
    expect(cart.lines).toHaveLength(4);
  });

  it("refuses a quantity past the cap, a 51st line and a second currency", () => {
    const full = applyCartAction(EMPTY_CART, {
      type: "add",
      line: line({ quantity: MAX_LINE_QUANTITY }),
    }).cart;
    const over = applyCartAction(full, {
      type: "add",
      line: line({ quantity: 1 }),
    });
    expect(over).toMatchObject({ ok: false, refusal: { reason: "quantity" } });
    expect(over.cart).toBe(full);

    let many = EMPTY_CART;
    for (let i = 0; i < MAX_CART_LINES; i++)
      many = applyCartAction(many, {
        type: "add",
        line: line({ priceId: `p${i}` }),
      }).cart;
    expect(
      applyCartAction(many, { type: "add", line: line({ priceId: "p-extra" }) })
    ).toMatchObject({
      ok: false,
      refusal: { reason: "lines" },
    });

    const usd = applyCartAction(EMPTY_CART, { type: "add", line: line() }).cart;
    expect(
      applyCartAction(usd, {
        type: "add",
        line: line({ priceId: "x", currency: "CAD" }),
      })
    ).toMatchObject({
      ok: false,
      refusal: { reason: "currency", cartCurrency: "USD", currency: "CAD" },
    });
    expect(
      applyCartAction(usd, { type: "setQuantity", index: 0, quantity: 0 }).ok
    ).toBe(false);
    expect(
      applyCartAction(usd, { type: "setQuantity", index: 0, quantity: 1.5 }).ok
    ).toBe(false);
  });

  it("merges a line edited into its twin, kept where it was edited", () => {
    let cart = EMPTY_CART;
    cart = applyCartAction(cart, {
      type: "add",
      line: line({ quantity: 2, answers: { logo: "A" } }),
    }).cart;
    cart = applyCartAction(cart, {
      type: "add",
      line: line({ quantity: 3, answers: { logo: "B" } }),
    }).cart;
    const r = applyCartAction(cart, {
      type: "setAnswers",
      index: 1,
      answers: { logo: "A" },
    });
    expect(r.ok).toBe(true);
    expect(r.cart.lines).toHaveLength(1);
    expect(r.cart.lines[0]).toMatchObject({
      quantity: 5,
      answers: { logo: "A" },
    });
  });

  it("sets and clears a size; a half-typed size leaves the line without one", () => {
    let cart = applyCartAction(EMPTY_CART, {
      type: "add",
      line: bySizeLine(),
    }).cart;
    cart = applyCartAction(cart, {
      type: "setSize",
      index: 0,
      size: { width: 4, height: 8, unit: "ft" },
    }).cart;
    expect(cart.lines[0]!.size).toEqual({ width: 4, height: 8, unit: "ft" });
    cart = applyCartAction(cart, {
      type: "setSize",
      index: 0,
      size: undefined,
    }).cart;
    expect(cart.lines[0]!.size).toBeUndefined();
  });
});

describe("stored carts", () => {
  it("drops malformed lines and replays the rest through the rules", () => {
    const raw = JSON.stringify({
      lines: [
        line({ quantity: 2 }),
        { listingId: "x" }, // not a line
        line({ quantity: 2000, priceId: "p2" }), // past the cap
        line({ priceId: "p3", currency: "CAD" as never }), // second currency
        line({ quantity: 1 }), // merges with the first
        { ...bySizeLine(), size: { unit: "parsecs", amount: 3 } }, // unknown unit: size dropped
      ],
    });
    const cart = parseStoredCart(raw);
    expect(cart.lines.map((l) => [l.priceId, l.quantity])).toEqual([
      ["price-1", 3],
      ["price-sz", 1],
    ]);
    expect(cart.lines[1]!.size).toBeUndefined();
    expect(parseStoredCart("{not json")).toBe(EMPTY_CART);
    expect(parseStoredCart(null)).toBe(EMPTY_CART);
  });

  it("persists per store, removes the key when emptied, and notifies subscribers", () => {
    const storage = memoryStorage();
    const a = createCart({ storeId: "A", storage });
    const seen: number[] = [];
    const off = a.subscribe((c) => seen.push(c.lines.length));
    expect(a.add(line()).ok).toBe(true);
    expect(
      JSON.parse(storage.data.get(cartStorageKey("A"))!).lines
    ).toHaveLength(1);
    expect(storage.data.has(cartStorageKey("B"))).toBe(false);

    const again = createCart({ storeId: "A", storage });
    expect(again.getSnapshot().lines).toHaveLength(1);
    expect(
      createCart({ storeId: "B", storage }).getSnapshot().lines
    ).toHaveLength(0);

    a.clear();
    expect(storage.data.has(cartStorageKey("A"))).toBe(false);
    expect(seen).toEqual([1, 0]);
    off();
  });

  it("keeps working when storage throws", () => {
    const broken: CartStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const cart = createCart({ storeId: "S", storage: broken });
    expect(cart.getSnapshot()).toBe(EMPTY_CART);
    expect(cart.add(line()).ok).toBe(true);
    expect(cart.getSnapshot().lines).toHaveLength(1);
  });

  it("returns the same snapshot object until something changes", () => {
    const cart = createCart({ storeId: "S", storage: null });
    const first = cart.getSnapshot();
    expect(cart.getSnapshot()).toBe(first);
    cart.setQuantity(5, 2); // no such line: no change
    expect(cart.getSnapshot()).toBe(first);
  });

  it("uses window.localStorage by default and follows other tabs", () => {
    localStorage.clear();
    const cart = createCart({ storeId: "tabs" });
    const counts: number[] = [];
    cart.subscribe((c) => counts.push(c.lines.length));
    cart.add(line());
    expect(localStorage.getItem(cartStorageKey("tabs"))).toContain("listing-1");
    // Another tab writes two lines.
    localStorage.setItem(
      cartStorageKey("tabs"),
      JSON.stringify({ lines: [line(), line({ priceId: "p2" })] })
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: cartStorageKey("tabs") })
    );
    expect(cart.getSnapshot().lines).toHaveLength(2);
    expect(counts).toEqual([1, 2]);
  });
});
