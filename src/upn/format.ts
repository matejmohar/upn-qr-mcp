/**
 * Values as they are printed on the paper form.
 *
 * Source: "Navodilo o obliki, vsebini in uporabi UPN QR", verzija 1.1, 3.2.1–3.2.4 ("Navodilo").
 */
import { formatIban } from "../iban.js";
import { validateReference } from "../reference.js";
import type { UpnFields } from "./fields.js";

export interface FormattedFields {
  amount?: string;
  payerIban?: string;
  recipientIban?: string;
  payerReference?: string;
  recipientReference?: string;
  paymentDate?: string;
  dueDate?: string;
}

/** Navodilo 3.2.1: "#.##0,00", printed as "***1.234,50". */
export function formatAmount(amount: number): string {
  const [whole, cents] = amount.toFixed(2).split(".");
  return `***${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${cents}`;
}

/** Navodilo 3.2.2: DD.MM.LLLL. */
export function formatDate(isoDate: string): string {
  return isoDate.split("-").reverse().join(".");
}

/** Navodilo 3.2.4: an SI reference as model, space, content; an RF reference in groups of four like an IBAN. */
export function formatReference(reference: string): string {
  const ref = validateReference(reference).normalized;
  return ref.startsWith("RF") ? formatIban(ref) : `${ref.slice(0, 4)} ${ref.slice(4)}`;
}

/** Navodilo 3.2.2 (dates), 3.2.3 (IBAN in fours) and 3.2.4 (references). */
export function formatFields(fields: UpnFields): FormattedFields {
  const out: FormattedFields = {};
  if (fields.amount !== undefined) out.amount = formatAmount(fields.amount);
  if (fields.payerIban) out.payerIban = formatIban(fields.payerIban);
  if (fields.recipientIban) out.recipientIban = formatIban(fields.recipientIban);
  if (fields.payerReference) out.payerReference = formatReference(fields.payerReference);
  if (fields.recipientReference) out.recipientReference = formatReference(fields.recipientReference);
  if (fields.paymentDate) out.paymentDate = formatDate(fields.paymentDate);
  if (fields.dueDate) out.dueDate = formatDate(fields.dueDate);
  return out;
}
