import type { LineSize, PricingBasis, PricingUnit } from "./types";

/**
 * A size as a form holds it: strings, so a half-typed "4." survives. The
 * server reads `LineSize`: either dimensions or the measure itself.
 */
export interface SizeDraft {
  /** "amount": one measure ("How many sq ft?"); "dims": width × height … */
  mode: "amount" | "dims";
  unit: PricingUnit;
  amount: string;
  length: string;
  width: string;
  height: string;
  depth: string;
}

/** One of a size draft's inputs. */
export type SizeDraftField = "amount" | "length" | "width" | "height" | "depth";

export function emptySizeDraft(unit: PricingUnit): SizeDraft {
  return {
    mode: "amount",
    unit,
    amount: "",
    length: "",
    width: "",
    height: "",
    depth: "",
  };
}

const str = (n?: number) => (n == null ? "" : String(n));

/** A stored size back into the form. */
export function sizeDraftFrom(
  size: LineSize | undefined,
  fallbackUnit: PricingUnit
): SizeDraft {
  if (!size) return emptySizeDraft(fallbackUnit);
  return {
    mode: size.amount != null ? "amount" : "dims",
    unit: size.unit,
    amount: str(size.amount),
    length: str(size.length),
    width: str(size.width),
    height: str(size.height),
    depth: str(size.depth),
  };
}

const parse = (s: string): number | undefined => {
  const t = s.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * The size to send for a basis, or undefined when nothing readable is typed.
 * What the server needs is the server's to check: a missing dimension comes
 * back as a 400 keyed `lines[i].size`, shown on the size input.
 */
export function sizeFromDraft(
  draft: SizeDraft,
  basis: PricingBasis
): LineSize | undefined {
  if (basis === "quantity") return undefined;
  if (basis === "length") {
    const length = parse(draft.length || draft.amount);
    return length == null ? undefined : { length, unit: draft.unit };
  }
  if (basis === "weight" || draft.mode === "amount") {
    const amount = parse(draft.amount);
    if (amount == null) return undefined;
    // A weight unit needs no basis; area and volume say which they are.
    return basis === "weight"
      ? { amount, unit: draft.unit }
      : { amount, basis, unit: draft.unit };
  }
  const width = parse(draft.width);
  const height = parse(draft.height);
  const depth = parse(draft.depth);
  if (width == null && height == null && depth == null) return undefined;
  return {
    ...(width != null ? { width } : {}),
    ...(height != null ? { height } : {}),
    ...(basis === "volume" && depth != null ? { depth } : {}),
    unit: draft.unit,
  };
}

export type SizeDraftCheck =
  | { ok: true; size: LineSize | undefined }
  | { ok: false; field: SizeDraftField; message: string };

/**
 * `sizeFromDraft`, telling "nothing typed" apart from "typed, but not a
 * size": blank is `{ ok: true, size: undefined }`; a value that is not a
 * number, or dimensions with one left blank, names the input to fix.
 */
export function checkSizeDraft(
  draft: SizeDraft,
  basis: PricingBasis
): SizeDraftCheck {
  if (basis === "quantity") return { ok: true, size: undefined };
  const fields: SizeDraftField[] =
    basis === "length"
      ? ["length"]
      : basis === "weight" || draft.mode === "amount"
        ? ["amount"]
        : basis === "volume"
          ? ["width", "height", "depth"]
          : ["width", "height"];
  const text = (f: SizeDraftField) =>
    (f === "length" ? draft.length || draft.amount : draft[f]).trim();
  if (fields.every((f) => text(f) === "")) return { ok: true, size: undefined };
  for (const f of fields) {
    const t = text(f);
    if (t === "")
      return { ok: false, field: f, message: `Enter the ${f} too.` };
    if (!Number.isFinite(Number(t)))
      return { ok: false, field: f, message: `The ${f} must be a number.` };
  }
  return { ok: true, size: sizeFromDraft(draft, basis) };
}
