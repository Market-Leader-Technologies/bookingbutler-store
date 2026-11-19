"use client";

import type { ReactNode } from "react";
import {
  useReceiptDownload,
  type UseReceiptDownloadOptions,
} from "../useReceipt";
import { cx } from "./primitives";

export interface ReceiptLinkProps extends UseReceiptDownloadOptions {
  /** The button's text. Default "Download receipt". */
  children?: ReactNode;
  className?: string;
}

/**
 * "Download receipt" for an order, once it is placed (`paymentStatus` not
 * `pending`; nothing is drawn before). Disabled while the PDF downloads;
 * a refusal is said under it ("Receipt not found.", "Try again in a
 * moment.").
 */
export function ReceiptLink({
  children = "Download receipt",
  className,
  ...options
}: ReceiptLinkProps) {
  const r = useReceiptDownload(options);
  if (!r.available) return null;
  return (
    <div
      className={cx("bb-receipt", className)}
      data-state={r.downloading ? "downloading" : r.failure ? "error" : "ready"}
    >
      <button
        type="button"
        className="bb-button bb-button--secondary bb-receipt__button"
        disabled={r.downloading}
        aria-busy={r.downloading || undefined}
        onClick={() => void r.download()}
      >
        {r.downloading ? "Downloading receipt…" : children}
      </button>
      {r.error && (
        <p className="bb-error bb-receipt__error" role="alert">
          {r.error}
        </p>
      )}
    </div>
  );
}
