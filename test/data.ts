/**
 * Fictional test data: IBANs with valid check digits but no account behind them (bank code 99 isn't assigned;
 * the NLB one is account 00000000), and made-up people and companies. The only other data in the tests are the
 * official examples from the ZBS standard (test/fixtures/zbs).
 */
import type { UpnFields } from "../src/upn/fields.js";

/** Bank code 99 is not assigned by the Bank of Slovenia, so no bank name. */
export const SI_IBAN = "SI56990000012345646";
export const SI_IBAN_2 = "SI56990000012345549";
/** Bank code 02 (NLB), account 00000000. */
export const SI_IBAN_NLB = "SI56020000000000068";
/** Institution code 91002, account 00000000. */
export const SI_IBAN_91002 = "SI56910020000000090";
export const DE_IBAN = "DE93999999990000000001";
export const AT_IBAN = "AT30999990000000000001";
/** The example in ISO 13616 itself. */
export const GB_IBAN = "GB82WEST12345698765432";

/** A bill: a fictional company invoices a fictional person. */
export const BILL: UpnFields = {
  payerName: "Ana Kovačič",
  payerAddress: "Cesta žrtev 7",
  payerCity: "2000 Maribor",
  amount: 123.45,
  purposeCode: "GDSV",
  purpose: "Račun 2026-104",
  dueDate: "2026-10-31",
  recipientIban: SI_IBAN,
  recipientReference: "SI12 0000020261047",
  recipientName: "Primer d.o.o.",
  recipientAddress: "Šmartinska cesta 1",
  recipientCity: "1000 Ljubljana",
};
