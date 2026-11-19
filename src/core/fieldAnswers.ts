import { CUSTOM_FIELD_TYPES, type FieldChoice, type FormField } from "./types";

/*
 * A line's answers to its form (`options[].fields`), as the shopper types
 * them. Drafts are kept as typed — a number stays the string in its box — and
 * turned into what checkout wants (`lines[].fields`) only when the line is
 * checked or sent, so a half-typed "1." is never lost to a parse and a wrong
 * value is said beside the field rather than dropped.
 */

/** A file the shop has received, held by its token until checkout claims it. */
export interface CartUpload {
  uploadToken: string;
  fileName: string;
  /** When an unclaimed upload is deleted; past it, the file goes again. */
  expiresAt?: string;
}

/**
 * What one field holds while it is being answered: text for text, number and
 * money boxes; a boolean for a checkbox; choice keys for a multi-select; the
 * upload (or uploads) for a file field.
 */
export type FieldDraft =
  string | boolean | string[] | CartUpload | CartUpload[];

export type FieldDrafts = Record<string, FieldDraft>;

/** Field key → what is wrong with its answer. */
export type FieldErrors = Record<string, string>;

/** Upload limits the server enforces, checked first so a doomed upload isn't sent. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const UPLOAD_ACCEPT =
  ".png,.jpg,.jpeg,.gif,.webp,.tif,.tiff,.svg,.pdf,.ai,.eps,.psd";

/** A select field's choices, each a stable key and a label to show. */
export interface Choice {
  key: string;
  label: string;
}

/** The field's choices, in order; a row without a key is dropped. */
export function fieldChoices(
  field: { choices?: FieldChoice[] } | null | undefined
): Choice[] {
  return (field?.choices ?? []).flatMap((choice) =>
    choice && typeof choice === "object" && choice.key
      ? [{ key: choice.key, label: choice.label ?? choice.key }]
      : []
  );
}

/** The key a value stands for: a key, or a label, matched to its key. */
export function choiceKeyFor(choices: Choice[], value: string): string {
  return (
    choices.find((c) => c.key === value)?.key ??
    choices.find((c) => c.label === value)?.key ??
    value
  );
}

export const isUpload = (value: unknown): value is CartUpload =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  typeof (value as CartUpload).uploadToken === "string" &&
  (value as CartUpload).uploadToken !== "" &&
  typeof (value as CartUpload).fileName === "string";

export const isFileField = (field: FormField) =>
  field.type === "file" || field.type === "files";

/** Whether a stored draft has the shape its field's input works with. */
export function draftFits(field: FormField, draft: unknown): boolean {
  switch (field.type) {
    case "boolean":
      return typeof draft === "boolean";
    case "multi_select":
      return Array.isArray(draft) && draft.every((v) => typeof v === "string");
    case "file":
      return isUpload(draft);
    case "files":
      return Array.isArray(draft) && draft.every(isUpload);
    default:
      return typeof draft === "string";
  }
}

const isBlank = (draft: FieldDraft | undefined): boolean =>
  draft === undefined ||
  draft === false ||
  (typeof draft === "string" && draft.trim() === "") ||
  (Array.isArray(draft) && draft.length === 0);

const uploadExpired = (upload: CartUpload, now: number) =>
  upload.expiresAt != null && Date.parse(upload.expiresAt) <= now;

/**
 * How many decimals a money field's minor units are worth
 * (`currencyDecimals`: 2 for USD). A money field without one is read as two.
 */
export const moneyDecimals = (field: FormField): number => {
  const d = field.currencyDecimals;
  return typeof d === "number" && Number.isInteger(d) && d >= 0 ? d : 2;
};

/** An amount for a hint: "12.50" (2 decimals), "12" (0). */
export const moneyExample = (decimals: number): string =>
  decimals > 0 ? `12.${"50".padEnd(decimals, "0").slice(0, decimals)}` : "12";

/**
 * Money typed into a form field ("12.50") → the minor units the field stores
 * (1250), or undefined when it isn't an amount in that currency. This reads
 * an *answer* to a money field (say "your budget"); it never prices a line.
 */
export function moneyToMinorUnits(
  text: string,
  decimals = 2
): number | undefined {
  const trimmed = text.trim().replace(/,/g, "");
  const pattern =
    decimals > 0
      ? new RegExp(`^-?\\d+(\\.\\d{0,${decimals}})?$|^-?\\.\\d{1,${decimals}}$`)
      : /^-?\d+$/;
  if (!pattern.test(trimmed)) return undefined;
  // Shift the decimal point textually: no floating-point multiply.
  const negative = trimmed.startsWith("-");
  const [whole = "", frac = ""] = trimmed.replace(/^-/, "").split(".");
  const digits = `${whole || "0"}${frac.padEnd(decimals, "0")}`;
  const minor = Number(digits) * (negative ? -1 : 1);
  return Number.isSafeInteger(minor) ? minor : undefined;
}

/**
 * The value checkout sends for one field, or an error to show on it. Blank
 * answers come back as `{}`: left out of the request, or refused here when
 * the field is required (the server would refuse it too).
 */
export function answerValue(
  field: FormField,
  draft: FieldDraft | undefined,
  now = Date.now()
): { value?: unknown; error?: string } {
  if (draft !== undefined && !draftFits(field, draft)) draft = undefined;
  if (isBlank(draft)) {
    if (!field.required) return {};
    if (field.type === "boolean") return { error: "Tick this to continue." };
    if (isFileField(field)) return { error: "Upload a file." };
    return { error: "Fill this in." };
  }
  switch (field.type) {
    case "number": {
      const n = Number((draft as string).trim());
      return Number.isFinite(n) ? { value: n } : { error: "Enter a number." };
    }
    case "integer": {
      const text = (draft as string).trim();
      const n = Number(text);
      return /^-?\d+$/.test(text) && Number.isSafeInteger(n)
        ? { value: n }
        : { error: "Enter a whole number." };
    }
    case "money": {
      const decimals = moneyDecimals(field);
      const minor = moneyToMinorUnits(draft as string, decimals);
      return minor === undefined
        ? { error: `Enter an amount like ${moneyExample(decimals)}.` }
        : { value: minor };
    }
    case "boolean":
      return { value: draft };
    case "single_select":
      return { value: choiceKeyFor(fieldChoices(field), draft as string) };
    case "multi_select": {
      const choices = fieldChoices(field);
      return {
        value: (draft as string[]).map((v) => choiceKeyFor(choices, v)),
      };
    }
    case "file": {
      const upload = draft as CartUpload;
      return uploadExpired(upload, now)
        ? { error: "This upload expired. Upload the file again." }
        : { value: upload.uploadToken };
    }
    case "files": {
      const uploads = draft as CartUpload[];
      return uploads.some((u) => uploadExpired(u, now))
        ? { error: "An upload expired. Remove it and upload the file again." }
        : { value: uploads.map((u) => u.uploadToken) };
    }
    default:
      return { value: (draft as string).trim() };
  }
}

/** Every field's error, or an empty object when the answers can be sent. */
export function validateAnswers(
  fields: FormField[],
  drafts: FieldDrafts,
  now = Date.now()
): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of fields) {
    if (!field.fieldKey) continue;
    const { error } = answerValue(field, drafts[field.fieldKey], now);
    if (error) errors[field.fieldKey] = error;
  }
  return errors;
}

/**
 * `lines[].fields`: the form's answers by key, blanks left out, and only keys
 * the form asks (an unknown key is a 400). Undefined when nothing is
 * answered, so a line without a form sends no `fields` at all.
 */
export function answersForCheckout(
  fields: FormField[],
  drafts: FieldDrafts | undefined
): Record<string, unknown> | undefined {
  if (!drafts) return undefined;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (!field.fieldKey) continue;
    // Expired or not, the token goes: the server's "upload the file again"
    // lands on the field either way, and checking the clock here would make
    // the request depend on when it was built.
    const { value } = answerValue(field, drafts[field.fieldKey], 0);
    if (value !== undefined) out[field.fieldKey] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The answers carried to a newly chosen option's form: a key it asks again,
 * with an answer its input can still hold, keeps the answer; the rest go.
 */
export function carryDrafts(
  fields: FormField[],
  drafts: FieldDrafts
): FieldDrafts {
  const out: FieldDrafts = {};
  for (const field of fields) {
    const key = field.fieldKey;
    if (key && key in drafts && draftFits(field, drafts[key]))
      out[key] = drafts[key]!;
  }
  return out;
}

/** A short reading of an answer for the cart: "Large", "logo.png", "Yes". */
export function answerSummary(
  field: FormField,
  draft: FieldDraft | undefined
): string | undefined {
  if (draft === undefined || !draftFits(field, draft) || isBlank(draft))
    return undefined;
  const choices = fieldChoices(field);
  const label = (v: string) =>
    choices.find((c) => c.key === v || c.label === v)?.label ?? v;
  switch (field.type) {
    case "boolean":
      return "Yes";
    case "single_select":
      return label(draft as string);
    case "multi_select":
      return (draft as string[]).map(label).join(", ");
    case "file":
      return (draft as CartUpload).fileName;
    case "files":
      return (draft as CartUpload[]).map((u) => u.fileName).join(", ");
    case "money":
      return `${(draft as string).trim()}${field.currency ? ` ${field.currency}` : ""}`;
    default:
      return (draft as string).trim();
  }
}

const isChoice = (value: unknown): boolean => {
  if (typeof value === "string") return true;
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    (c.key === undefined || typeof c.key === "string") &&
    (c.label === undefined || typeof c.label === "string")
  );
};

/** Whether a stored form field is shaped enough to draw. */
export function isFormField(value: unknown): value is FormField {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.fieldKey === "string" &&
    v.fieldKey !== "" &&
    (v.type === undefined ||
      (CUSTOM_FIELD_TYPES as readonly unknown[]).includes(v.type)) &&
    (v.name === undefined || typeof v.name === "string") &&
    (v.choices === undefined ||
      (Array.isArray(v.choices) && v.choices.every(isChoice)))
  );
}

/** Stable text for comparing two lines' answers. */
export function draftsKey(drafts: FieldDrafts | undefined): string {
  if (!drafts) return "";
  const keys = Object.keys(drafts).sort();
  return keys.length ? JSON.stringify(keys.map((k) => [k, drafts[k]])) : "";
}
