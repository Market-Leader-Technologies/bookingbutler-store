import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Receipt } from "@bookingbutler/store";
import { ReceiptLink, StoreProvider } from "@bookingbutler/store/react";
import { BASE, STORE, stubFetch } from "../helpers";

const pdf = () =>
  new Response("%PDF-1.7", {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=Receipt-1042.pdf",
    },
  });

function mount(
  props: Partial<Parameters<typeof ReceiptLink>[0]>,
  receipt: () =>
    Response | { status: number; body: unknown } | Promise<Response>,
  order: unknown = { token: "tok", paymentStatus: "paid", orderNumber: "1042" }
) {
  const stub = stubFetch({
    "GET /public/orders/{t}/receipt": receipt,
    "GET /public/orders/{t}": () => ({ body: order }),
  });
  const onDownload = vi.fn<(r: Receipt) => void>();
  render(
    <StoreProvider storeId={STORE} baseUrl={BASE} fetch={stub.fetch}>
      <ReceiptLink token="tok" onDownload={onDownload} {...props} />
    </StoreProvider>
  );
  const receipts = () => stub.calls.filter((c) => c.path.endsWith("/receipt"));
  return { ...stub, onDownload, receipts };
}

const button = () => screen.getByRole("button", { name: /receipt/i });

describe("<ReceiptLink>", () => {
  it("is not shown while the order is pending", async () => {
    const { calls } = mount({ order: { paymentStatus: "pending" } }, pdf);
    await act(async () => {});
    expect(screen.queryByRole("button")).toBeNull();
    // The order was given: it isn't read again.
    expect(calls).toHaveLength(0);
  });

  it("downloads the PDF under the server's name once the order is placed", async () => {
    const { onDownload, receipts } = mount(
      { order: { paymentStatus: "unpaid", orderNumber: "1042" } },
      pdf
    );
    fireEvent.click(button());
    await waitFor(() => expect(onDownload).toHaveBeenCalledTimes(1));
    expect(onDownload.mock.calls[0]![0].filename).toBe("Receipt-1042.pdf");
    expect(receipts()).toHaveLength(1);
  });

  it("reads the order by its token when not given, and hides for a pending one", async () => {
    mount({}, pdf, { token: "tok", paymentStatus: "pending" });
    await act(async () => {});
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reads the order by its token when not given, and shows for a placed one", async () => {
    mount({}, pdf);
    expect(
      await screen.findByRole("button", { name: "Download receipt" })
    ).toBeTruthy();
  });

  it("is disabled while a download is in flight, and sends one at a time", async () => {
    let finish!: (r: Response) => void;
    const { receipts, onDownload } = mount(
      { order: { paymentStatus: "paid" } },
      () => new Promise<Response>((r) => (finish = r))
    );
    fireEvent.click(button());
    await waitFor(() =>
      expect((button() as HTMLButtonElement).disabled).toBe(true)
    );
    expect(button().textContent).toBe("Downloading receipt…");
    fireEvent.click(button());
    expect(receipts()).toHaveLength(1);
    await act(async () => finish(pdf()));
    await waitFor(() =>
      expect((button() as HTMLButtonElement).disabled).toBe(false)
    );
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it.each([
    [404, { error: "order not found" }, "Receipt not found."],
    [
      429,
      {
        error: "rate limit exceeded",
        message: "Too many requests. Please try again later.",
      },
      "Try again in a moment.",
    ],
    [
      503,
      { error: "renderer unavailable" },
      "The receipt couldn't be made just now. Try again in a moment.",
    ],
    [
      409,
      { error: "not placed", code: "ORDER_NOT_PLACED" },
      "This order hasn't been placed yet, so it has no receipt.",
    ],
  ])("says what a %i means", async (status, body, message) => {
    const { onDownload } = mount({ order: { paymentStatus: "paid" } }, () => ({
      status,
      body,
    }));
    fireEvent.click(button());
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(onDownload).not.toHaveBeenCalled();
    expect((button() as HTMLButtonElement).disabled).toBe(false);
  });
});
