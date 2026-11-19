"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  choiceKeyFor,
  fieldChoices,
  formatMoney,
  formatTier,
  isUpload,
  measureUnitLabel,
  moneyDecimals,
  sortedTiers,
  tierStartLabel,
  unitsForBasis,
  UPLOAD_ACCEPT,
  type CartUpload,
  type CurrencyCode,
  type FieldDraft,
  type FieldDrafts,
  type FieldErrors,
  type FormField,
  type PricingBasis,
  type PricingRate,
  type PricingUnit,
  type SizeDraft,
  type SizeDraftField,
  type UploadFile,
} from "@bookingbutler/store";
import { useStoreContext } from "../context";
import { useLocale } from "../useCart";

/** Joins class names, dropping blanks. */
export const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).join(" ");

/** An amount from the server, formatted; "—" when there is none. */
export function Money({
  cents,
  currency,
  className,
}: {
  cents: number | null | undefined;
  currency?: CurrencyCode | string;
  className?: string;
}) {
  const locale = useLocale();
  return (
    <span className={cx("bb-money", className)}>
      {formatMoney(cents, currency, { locale })}
    </span>
  );
}

/** A small spinner with an accessible name. */
export function Spinner({ label }: { label: string }) {
  return (
    <span className="bb-spinner" role="status" aria-label={label}>
      <span aria-hidden="true" className="bb-spinner__dot" />
    </span>
  );
}

// ─── Rate table ──────────────────────────────────────────────────────────────

/**
 * A rate's tiers as a small price table ("From 0 sq ft · $9.00 / sq ft").
 * Nothing for a single tier: the price line already says it. Display only.
 */
export function RateTable({
  rate,
  currency,
  className,
}: {
  rate: PricingRate;
  currency?: CurrencyCode | string;
  className?: string;
}) {
  const locale = useLocale();
  const tiers = sortedTiers(rate);
  if (tiers.length <= 1) return null;
  const startUnit = tierStartLabel(rate);
  return (
    <div className={cx("bb-rate-table", className)}>
      <table>
        <caption className="bb-sr-only">Price table</caption>
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">Price</th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((tier, i) => (
            <tr key={`${tier.start ?? 0}-${i}`}>
              <td>
                {tier.start ?? 0}
                {startUnit ? ` ${startUnit}` : ""}
              </td>
              <td>{formatTier(tier, rate, currency ?? "USD", { locale })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="bb-hint">
        {rate.mode === "graduated"
          ? "Each part is priced at its own tier."
          : "The whole line is priced at the tier it reaches."}
      </p>
    </div>
  );
}

// ─── Size input ──────────────────────────────────────────────────────────────

export interface SizeInputProps {
  basis: PricingBasis;
  value: SizeDraft;
  onChange: (next: SizeDraft) => void;
  /** Prefix for the inputs' ids; one is made up when left out. */
  idPrefix?: string;
  error?: string | undefined;
  disabled?: boolean;
  invalidField?: SizeDraftField;
  className?: string;
}

/**
 * The size beside a quantity, for a price by length, area, volume or weight.
 * Area and volume default to one amount ("How many sq ft?") with a toggle to
 * dimensions; a length is one input; a weight is only ever an amount. The
 * draft keeps what is typed, so a half-typed "4." survives.
 */
export function SizeInput({
  basis,
  value,
  onChange,
  idPrefix,
  error,
  disabled,
  invalidField,
  className,
}: SizeInputProps) {
  const auto = useId();
  const prefix = idPrefix ?? `bb-size-${auto.replace(/:/g, "")}`;
  if (basis === "quantity") return null;
  const set = (patch: Partial<SizeDraft>) => onChange({ ...value, ...patch });
  const units = unitsForBasis(basis);
  const canDims = basis === "area" || basis === "volume";
  const dims = canDims && value.mode === "dims";
  const errorId = error ? `${prefix}-error` : undefined;

  const field = (key: SizeDraftField, label: string) => (
    <div className="bb-field bb-size__field">
      <label className="bb-label" htmlFor={`${prefix}-${key}`}>
        {label}
      </label>
      <input
        id={`${prefix}-${key}`}
        className="bb-input"
        inputMode="decimal"
        autoComplete="off"
        value={value[key]}
        disabled={disabled}
        aria-invalid={!!error || invalidField === key || undefined}
        aria-describedby={errorId}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </div>
  );

  const amountLabel =
    basis === "length"
      ? "Length"
      : `How many ${measureUnitLabel(basis, value.unit) || value.unit}?`;

  return (
    <fieldset
      className={cx("bb-size", className)}
      data-mode={dims ? "dims" : "amount"}
      data-invalid={error ? "" : undefined}
    >
      <legend className="bb-label">Size</legend>
      <div className="bb-size__row">
        {basis === "length" ? (
          field("length", "Length")
        ) : dims ? (
          <>
            {field("width", "Width")}
            {field("height", "Height")}
            {basis === "volume" && field("depth", "Depth")}
          </>
        ) : (
          field("amount", amountLabel)
        )}
        <div className="bb-field bb-size__unit">
          <label className="bb-label" htmlFor={`${prefix}-unit`}>
            Unit
          </label>
          <select
            id={`${prefix}-unit`}
            className="bb-input bb-select"
            value={value.unit}
            disabled={disabled}
            onChange={(e) => set({ unit: e.target.value as PricingUnit })}
          >
            {units.map((u) => (
              <option key={u} value={u}>
                {dims || basis === "length"
                  ? u
                  : measureUnitLabel(basis, u) || u}
              </option>
            ))}
          </select>
        </div>
      </div>
      {canDims && (
        <button
          type="button"
          className="bb-link-button"
          disabled={disabled}
          onClick={() => set({ mode: dims ? "amount" : "dims" })}
        >
          {dims ? "Enter the amount instead" : "Enter dimensions instead"}
        </button>
      )}
      {error && (
        <p id={errorId} className="bb-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}

// ─── Quantity ────────────────────────────────────────────────────────────────

/** − [n] + for a cart line. Each change is a whole number from 1 to `max`. */
export function QuantityStepper({
  value,
  onChange,
  name,
  max,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  name: string;
  max: number;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <div
      className="bb-quantity"
      role="group"
      aria-label={`Quantity of ${name}`}
    >
      <button
        type="button"
        className="bb-button bb-button--icon"
        aria-label={`One fewer ${name}`}
        disabled={disabled || value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <span aria-hidden="true">−</span>
      </button>
      <input
        className="bb-input bb-quantity__input"
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        step={1}
        value={text}
        disabled={disabled}
        aria-label={`Quantity of ${name}`}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (
            e.target.value !== "" &&
            Number.isInteger(n) &&
            n >= 1 &&
            n <= max
          )
            onChange(n);
        }}
        onBlur={() => setText(String(value))}
      />
      <button
        type="button"
        className="bb-button bb-button--icon"
        aria-label={`One more ${name}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

// ─── Line form (options[].fields) ────────────────────────────────────────────

export interface LineFieldsFormProps {
  fields: FormField[];
  drafts: FieldDrafts;
  onChange: (drafts: FieldDrafts) => void;
  errors?: FieldErrors;
  disabled?: boolean;
  /** Defaults to the provider's uploader (`POST /uploads`). */
  upload?: UploadFile;
  /** Whether an upload is still going, so Add to cart can wait for it. */
  onBusyChange?: (busy: boolean) => void;
  /**
   * Names the form being answered (the option, or the cart line). An upload
   * that lands after it changed is dropped, so a file picked for one option
   * can't turn up in another's answers.
   */
  formKey: string;
  idPrefix?: string;
  className?: string;
}

/**
 * The form a line answers, one native input per field. A file field uploads
 * the moment a file is picked and holds the token the upload returns, which
 * is what checkout sends.
 */
export function LineFieldsForm({
  fields,
  drafts,
  onChange,
  errors = {},
  disabled = false,
  upload: givenUpload,
  onBusyChange,
  formKey,
  idPrefix,
  className,
}: LineFieldsFormProps) {
  const ctx = useStoreContext();
  const upload = givenUpload ?? ctx.upload;
  const auto = useId();
  const prefix = idPrefix ?? `bb-f-${auto.replace(/:/g, "")}`;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onBusyRef = useRef(onBusyChange);
  onBusyRef.current = onBusyChange;
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  /** Bumped when the form changes or goes: a pending upload then writes nothing. */
  const generation = useRef(0);
  /** The newest pick per single-file field; an older one finishing is dropped. */
  const latestPick = useRef<Record<string, number>>({});

  useEffect(() => {
    setUploading({});
    setUploadErrors({});
    return () => {
      generation.current += 1;
    };
  }, [formKey]);

  const busy = Object.values(uploading).some((n) => n > 0);
  useEffect(() => {
    onBusyRef.current?.(busy);
  }, [busy]);
  useEffect(() => () => onBusyRef.current?.(false), []);

  const set = (key: string, value: FieldDraft | undefined) => {
    const next = { ...draftsRef.current };
    if (value === undefined) delete next[key];
    else next[key] = value;
    draftsRef.current = next;
    onChangeRef.current(next);
  };

  const pickFiles = async (field: FormField, files: File[]) => {
    const key = field.fieldKey ?? "";
    if (!key || files.length === 0) return;
    const multiple = field.type === "files";
    const gen = generation.current;
    const pick = (latestPick.current[key] ?? 0) + 1;
    latestPick.current[key] = pick;
    setUploadErrors(({ [key]: _gone, ...rest }) => rest);
    setUploading((prev) => ({
      ...prev,
      [key]: (prev[key] ?? 0) + files.length,
    }));
    const stillWanted = () =>
      gen === generation.current &&
      (multiple || latestPick.current[key] === pick);
    for (const file of files) {
      try {
        const done = await upload(file);
        if (!stillWanted()) continue;
        const current = draftsRef.current[key];
        set(
          key,
          multiple
            ? [
                ...(Array.isArray(current) ? current.filter(isUpload) : []),
                done,
              ]
            : done
        );
      } catch (err) {
        if (stillWanted())
          setUploadErrors((prev) => ({
            ...prev,
            [key]: err instanceof Error ? err.message : String(err),
          }));
      } finally {
        if (gen === generation.current)
          setUploading((prev) => ({
            ...prev,
            [key]: Math.max(0, (prev[key] ?? 0) - 1),
          }));
      }
    }
  };

  return (
    <div
      className={cx("bb-line-form", className)}
      data-busy={busy ? "" : undefined}
    >
      {fields.map((field) => {
        const key = field.fieldKey;
        if (!key) return null;
        const id = `${prefix}-${key}`;
        const error = uploadErrors[key] ?? errors[key];
        const describedBy =
          [error && `${id}-error`, field.helpText && `${id}-help`]
            .filter(Boolean)
            .join(" ") || undefined;
        const label = field.name || key;
        const isBool = field.type === "boolean";
        const isGroup = field.type === "multi_select";
        return (
          <div
            key={key}
            className="bb-field"
            data-type={field.type}
            data-invalid={error ? "" : undefined}
          >
            {!isBool && !isGroup && (
              <label className="bb-label" htmlFor={id}>
                {label}
                <RequiredMark required={field.required} />
              </label>
            )}
            <FieldInput
              field={field}
              id={id}
              label={label}
              value={drafts[key]}
              disabled={disabled}
              error={Boolean(error)}
              describedBy={describedBy}
              uploading={(uploading[key] ?? 0) > 0}
              onValue={(v) => set(key, v)}
              onFiles={(files) => void pickFiles(field, files)}
            />
            {field.helpText && (
              <p id={`${id}-help`} className="bb-hint">
                {field.helpText}
              </p>
            )}
            {error && (
              <p id={`${id}-error`} className="bb-error" role="alert">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RequiredMark({ required }: { required?: boolean }): ReactNode {
  return required ? (
    <span className="bb-required" aria-hidden="true">
      {" "}
      *
    </span>
  ) : (
    <span className="bb-optional"> (optional)</span>
  );
}

function FieldInput({
  field,
  id,
  label,
  value,
  disabled,
  error,
  describedBy,
  uploading,
  onValue,
  onFiles,
}: {
  field: FormField;
  id: string;
  label: string;
  value: FieldDraft | undefined;
  disabled: boolean;
  error: boolean;
  describedBy: string | undefined;
  uploading: boolean;
  onValue: (value: FieldDraft | undefined) => void;
  onFiles: (files: File[]) => void;
}) {
  const text = typeof value === "string" ? value : "";
  const orNothing = (v: string) => (v === "" ? undefined : v);
  const common = {
    id,
    disabled,
    className: "bb-input",
    "aria-invalid": error || undefined,
    "aria-describedby": describedBy,
    "aria-required": field.required || undefined,
  };
  switch (field.type) {
    case "multiline":
    case "html":
      return (
        <textarea
          {...common}
          className="bb-input bb-textarea"
          rows={4}
          value={text}
          onChange={(e) => onValue(orNothing(e.target.value))}
        />
      );
    case "number":
      return (
        <input
          {...common}
          type="number"
          inputMode="decimal"
          step="any"
          value={text}
          onChange={(e) => onValue(orNothing(e.target.value))}
        />
      );
    case "integer":
      return (
        <input
          {...common}
          type="number"
          inputMode="numeric"
          step={1}
          value={text}
          onChange={(e) => onValue(orNothing(e.target.value))}
        />
      );
    case "money":
      return (
        <div className="bb-money-input">
          <input
            {...common}
            type="text"
            inputMode={moneyDecimals(field) > 0 ? "decimal" : "numeric"}
            placeholder={(0).toFixed(moneyDecimals(field))}
            value={text}
            onChange={(e) => onValue(orNothing(e.target.value))}
          />
          {field.currency && (
            <span className="bb-money-input__currency">{field.currency}</span>
          )}
        </div>
      );
    case "boolean":
      return (
        <label className="bb-check" htmlFor={id}>
          <input
            {...common}
            className="bb-checkbox"
            type="checkbox"
            checked={value === true}
            onChange={(e) => onValue(e.target.checked ? true : undefined)}
          />
          <span>
            {label}
            <RequiredMark required={field.required} />
          </span>
        </label>
      );
    case "date":
      return (
        <input
          {...common}
          type="date"
          value={text.slice(0, 10)}
          onChange={(e) => onValue(orNothing(e.target.value))}
        />
      );
    case "single_select": {
      const choices = fieldChoices(field);
      return (
        <select
          {...common}
          className="bb-input bb-select"
          value={text ? choiceKeyFor(choices, text) : ""}
          onChange={(e) => onValue(orNothing(e.target.value))}
        >
          <option value="">{field.required ? "Choose…" : "None"}</option>
          {choices.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      );
    }
    case "multi_select": {
      const choices = fieldChoices(field);
      const selected = Array.isArray(value)
        ? (value as string[]).map((v) => choiceKeyFor(choices, v))
        : [];
      return (
        <fieldset
          className="bb-choices"
          aria-describedby={describedBy}
          aria-invalid={error || undefined}
        >
          <legend className="bb-label">
            {label}
            <RequiredMark required={field.required} />
          </legend>
          {choices.map((choice) => {
            const on = selected.includes(choice.key);
            const choiceId = `${id}-${choice.key}`;
            return (
              <label key={choice.key} className="bb-check" htmlFor={choiceId}>
                <input
                  id={choiceId}
                  className="bb-checkbox"
                  type="checkbox"
                  disabled={disabled}
                  checked={on}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, choice.key]
                      : selected.filter((k) => k !== choice.key);
                    onValue(next.length ? next : undefined);
                  }}
                />
                <span>{choice.label}</span>
              </label>
            );
          })}
        </fieldset>
      );
    }
    case "file":
    case "files": {
      const multiple = field.type === "files";
      const uploads: CartUpload[] = multiple
        ? Array.isArray(value)
          ? (value as unknown[]).filter(isUpload)
          : []
        : isUpload(value)
          ? [value]
          : [];
      const remove = (token: string) => {
        const rest = uploads.filter((u) => u.uploadToken !== token);
        onValue(multiple ? (rest.length ? rest : undefined) : undefined);
      };
      const canPick = multiple || uploads.length === 0;
      return (
        <div
          className="bb-upload"
          data-state={
            uploading ? "uploading" : uploads.length ? "done" : "empty"
          }
        >
          {uploads.length > 0 && (
            <ul className="bb-upload__files">
              {uploads.map((u) => (
                <li key={u.uploadToken} className="bb-upload__file">
                  <span className="bb-upload__name">{u.fileName}</span>
                  <button
                    type="button"
                    className="bb-button bb-button--icon bb-button--ghost"
                    disabled={disabled}
                    aria-label={`Remove ${u.fileName}`}
                    onClick={() => remove(u.uploadToken)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label
            className="bb-button bb-button--secondary bb-upload__pick"
            data-disabled={disabled || uploading ? "" : undefined}
          >
            {uploading
              ? "Uploading…"
              : !canPick
                ? "Replace the file"
                : uploads.length > 0
                  ? "Add another file"
                  : multiple
                    ? "Upload files"
                    : "Upload a file"}
            <input
              {...common}
              className="bb-sr-only"
              type="file"
              accept={UPLOAD_ACCEPT}
              multiple={multiple}
              disabled={disabled || uploading}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                onFiles(multiple ? files : files.slice(0, 1));
              }}
            />
          </label>
          <p className="bb-hint">
            PNG, JPEG, GIF, WebP, TIFF, SVG, PDF, AI, EPS or PSD, up to 50 MB.
          </p>
        </div>
      );
    }
    case "url":
      return (
        <input
          {...common}
          type="url"
          inputMode="url"
          value={text}
          onChange={(e) => onValue(orNothing(e.target.value))}
        />
      );
    case "phone":
      return (
        <input
          {...common}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={text}
          onChange={(e) => onValue(orNothing(e.target.value))}
        />
      );
    default:
      return (
        <input
          {...common}
          type="text"
          value={text}
          onChange={(e) => onValue(orNothing(e.target.value))}
        />
      );
  }
}
