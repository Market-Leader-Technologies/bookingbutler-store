import { ListingGrid } from "@bookingbutler/store/react";
import { serverClient } from "./store";

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const { q, category } = await searchParams;
  const params = {
    limit: 24,
    ...(q ? { q } : {}),
    ...(category ? { categoryId: category } : {}),
  };
  // Rendered on the server for SEO; the grid takes over in the browser.
  const firstPage = await serverClient
    .listListings(params)
    .catch(() => undefined);
  return (
    <ListingGrid
      params={params}
      {...(firstPage ? { initialData: firstPage } : {})}
    />
  );
}
