import type { Address } from "./types";

/** The shape of an email checkout accepts; the server checks it again. */
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMPTY_ADDRESS: Address = Object.freeze({
  street1: "",
  street2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
});

/** A delivery needs the street, the city, and a state or postal code. */
export const addressIncomplete = (address: Address): boolean =>
  !address.street1?.trim() ||
  !address.city?.trim() ||
  !(address.state?.trim() || address.postalCode?.trim());
