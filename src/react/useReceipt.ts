"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  classifyReceiptError,
  isAbortError,
  receiptAvailable,
  saveReceipt,
  type Order,
  type Receipt,
  type ReceiptFailure,
  type StoreClient,
} from "@bookingbutler/store";
import { StoreContext } from "./context";

export interface UseReceiptDownloadOptions {
  /** The order's public token (the pay page's). */
  token: string | null | undefined;
  /**
   * The order, when the page has it already: the receipt is offered once
   * its `paymentStatus` is not `pending`. Left out, the order is read by its
   * token (`GET /public/orders/{token}`) to find out.
   */
  order?: Pick<Order, "paymentStatus" | "orderNumber"> | null;
  /** The client to use outside a `<StoreProvider>`. */
  client?: Pick<StoreClient, "downloadReceipt" | "getOrder">;
  /**
   * What to do with the file. Defaults to saving it in the browser
   * (`saveReceipt`); pass your own to open it in a tab or upload it.
   */
  onDownload?: (receipt: Receipt) => void;
}

export interface UseReceiptDownloadResult {
  /** The order is placed: offer the receipt. False until that is known. */
  available: boolean;
  /** A download is in flight: disable the button. */
  downloading: boolean;
  /** The last download's refusal, or null. */
  failure: ReceiptFailure | null;
  /** What to say about it: "Receipt not found.", "Try again in a moment."… */
  error: string | null;
  /** Downloads (and by default saves) the receipt. Ignored while one is in flight. */
  download(): Promise<Receipt | undefined>;
}

/**
 * Downloading an order's receipt (`GET /public/orders/{token}/receipt`, a
 * PDF made as the order stands now). It is offered only once the order is
 * placed; one download at a time, since receipts have a limit of their own
 * (10 in a burst, then 1 every 10 seconds); refusals come back as plain
 * sentences.
 */
export function useReceiptDownload({
  token,
  order,
  client: clientOption,
  onDownload,
}: UseReceiptDownloadOptions): UseReceiptDownloadResult {
  const context = useContext(StoreContext);
  const client = clientOption ?? context?.client;
  if (!client)
    throw new Error(
      "@bookingbutler/store/react: useReceiptDownload needs a <StoreProvider> or a client."
    );
  const [fetched, setFetched] = useState<{
    token: string;
    order: Pick<Order, "paymentStatus" | "orderNumber">;
  } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [failure, setFailure] = useState<ReceiptFailure | null>(null);
  const busy = useRef(false);
  const onDownloadRef = useRef(onDownload);
  onDownloadRef.current = onDownload;

  const given = order !== undefined;
  useEffect(() => {
    if (given || !token) return;
    const controller = new AbortController();
    client
      .getOrder(token, { signal: controller.signal })
      .then((o) => {
        if (!controller.signal.aborted) setFetched({ token, order: o });
      })
      .catch(() => {
        // No order, no receipt: the button stays hidden.
      });
    return () => controller.abort();
  }, [client, token, given]);

  useEffect(() => setFailure(null), [token]);

  const known = given
    ? order
    : fetched && fetched.token === token
      ? fetched.order
      : undefined;
  const available = Boolean(token) && receiptAvailable(known);

  const download = useCallback(async (): Promise<Receipt | undefined> => {
    if (!token || busy.current) return undefined;
    busy.current = true;
    setDownloading(true);
    setFailure(null);
    try {
      const receipt = await client.downloadReceipt(token, {
        ...(known?.orderNumber ? { orderNumber: known.orderNumber } : {}),
      });
      (onDownloadRef.current ?? saveReceipt)(receipt);
      return receipt;
    } catch (err) {
      if (!isAbortError(err)) setFailure(classifyReceiptError(err));
      return undefined;
    } finally {
      busy.current = false;
      setDownloading(false);
    }
  }, [client, token, known?.orderNumber]);

  return {
    available,
    downloading,
    failure,
    error: failure?.message ?? null,
    download,
  };
}
