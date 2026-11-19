import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isStoreApiError } from "@bookingbutler/store";
import { ListingDetail } from "@bookingbutler/store/react";
import { serverClient } from "../store";

async function load(listingId: string) {
  try {
    return await serverClient.getListing(listingId);
  } catch (err) {
    if (isStoreApiError(err) && err.status === 404) notFound();
    throw err;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ listingId: string }>;
}): Promise<Metadata> {
  const listing = await load((await params).listingId);
  return { title: listing.name, description: listing.description };
}

export default async function ListingPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const listing = await load((await params).listingId);
  return <ListingDetail listing={listing} />;
}
