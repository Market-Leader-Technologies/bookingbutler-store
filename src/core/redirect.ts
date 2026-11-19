/**
 * Leaves the site for the order's hosted pay page (`checkoutUrl` from
 * `POST /checkout`): a full page load. The SDK never talks to the payment
 * provider itself; the pay page does.
 *
 * Only http(s) URLs are followed, so a tampered response can't run script.
 */
export function redirectToCheckout(
  checkoutUrl: string,
  location: Pick<Location, "assign"> | undefined = typeof window !== "undefined"
    ? window.location
    : undefined
): void {
  let url: URL;
  try {
    url = new URL(checkoutUrl);
  } catch {
    throw new Error(`redirectToCheckout: not a URL: ${checkoutUrl}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error(`redirectToCheckout: refusing ${url.protocol} URL`);
  if (!location) throw new Error("redirectToCheckout: no window to redirect");
  location.assign(url.toString());
}
