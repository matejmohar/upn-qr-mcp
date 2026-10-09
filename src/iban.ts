/**
 * IBAN validation per ISO 13616 (mod 97-10 check digits, ISO/IEC 7064), and the bank behind a
 * Slovenian IBAN.
 *
 * Only what ISO 13616 itself defines is checked for every country: two letters, two check digits, up
 * to 30 letters and digits, and the mod-97 check. The per-country length and format (the SWIFT IBAN
 * registry) is only applied to SI, whose structure the UPN QR standard and the Bank of Slovenia
 * define. TODO: per-country IBAN lengths from the SWIFT IBAN registry.
 */
import { SI_BANKS, SI_BANKS_SOURCE } from "./si-banks.js";

export { SI_BANKS_SOURCE };

export interface IbanResult {
  valid: boolean;
  /** Upper case, without spaces; what goes into the QR code. */
  normalized: string;
  /** ISO 3166 country code from the first two letters, when they are letters. */
  country?: string;
  /** For SI IBANs: the bank, from the Bank of Slovenia's list of IBAN issuer codes. */
  bankName?: string;
  errors: string[];
}

/** Slovenian IBAN: SI, 2 check digits, 15 digits. UPN QR – tehnični standard, Navodilo 3.2.3: "SI56 9999 9999 9999 999". */
const SI_LENGTH = 19;
const MAX_LENGTH = 34; // ISO 13616: up to 34 characters; UPN QR – tehnični standard, 5.2 field 15: max 34.

export function normalizeIban(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

/** Remainder of a long decimal string modulo 97 (ISO/IEC 7064 MOD 97-10), digit by digit to stay within number precision. */
export function mod97(digits: string): number {
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest;
}

/** Letters to numbers, A = 10 … Z = 35, as in ISO 13616 and ISO 11649. */
export function lettersToDigits(text: string): string {
  return text.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
}

/** ISO 13616: move the first four characters to the end, convert letters, and the remainder mod 97 must be 1. */
export function ibanChecksumOk(iban: string): boolean {
  return mod97(lettersToDigits(iban.slice(4) + iban.slice(0, 4))) === 1;
}

export function validateIban(input: string): IbanResult {
  const normalized = normalizeIban(input);
  const errors: string[] = [];
  const country = /^[A-Z]{2}/.test(normalized) ? normalized.slice(0, 2) : undefined;

  if (!normalized) {
    errors.push("The IBAN is empty.");
  } else if (!/^[A-Z0-9]+$/.test(normalized)) {
    errors.push("An IBAN has only letters A-Z and digits (spaces are ignored).");
  } else if (!/^[A-Z]{2}[0-9]{2}/.test(normalized)) {
    errors.push("An IBAN starts with a two-letter country code and two check digits, e.g. SI56.");
  } else if (normalized.length > MAX_LENGTH) {
    errors.push(`An IBAN has at most ${MAX_LENGTH} characters; this one has ${normalized.length}.`);
  } else if (normalized.length < 5) {
    errors.push("The IBAN is too short.");
  } else if (country === "SI" && !/^SI[0-9]{17}$/.test(normalized)) {
    errors.push(`A Slovenian IBAN has ${SI_LENGTH} characters, SI and 17 digits (SI56 9999 9999 9999 999); this one has ${normalized.length}.`);
  } else if (!ibanChecksumOk(normalized)) {
    errors.push("The check digits don't match: the IBAN has a typo (ISO 13616 mod-97 check failed).");
  }

  const valid = errors.length === 0;
  const bankName = valid && country === "SI" ? siBankName(normalized) : undefined;
  return { valid, normalized, ...(country ? { country } : {}), ...(bankName ? { bankName } : {}), errors };
}

/**
 * The bank of a Slovenian IBAN. Its 5th to 9th characters are the issuer's national identification code;
 * the Bank of Slovenia assigns the first two digits to a bank (the other three are the bank's own),
 * and five-digit codes starting with 91 to payment and e-money institutions.
 */
export function siBankName(iban: string): string | undefined {
  const code = iban.slice(4, 9);
  return SI_BANKS[code] ?? SI_BANKS[code.slice(0, 2)];
}

/** Groups of four for display: "SI56 0510 0801 0486 080". Navodilo o obliki, vsebini in uporabi UPN QR, 3.2.3. */
export function formatIban(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})(?=.)/g, "$1 ");
}
