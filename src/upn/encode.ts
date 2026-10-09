/**
 * UPN fields → the text stored in the QR code.
 *
 * UPN QR – tehnični standard, 5.2 "Struktura zapisa kode QR" ("Standard 5.2"): fields 1 to 20 in order, each
 * followed by LF (0x0A); an empty field is just the separator. The optional reserve (rezerva) after field 20
 * is left empty here.
 */
import { normalizeIban } from "../iban.js";
import { normalizeReference } from "../reference.js";
import { encodeLatin2 } from "./charset.js";
import { lengthChecksum } from "./checksum.js";
import { FIELDS, LEADING_STYLE, type UpnFields } from "./fields.js";

export const SEPARATOR = "\n";

/** Field 9, Standard 5.2: cents, 11 digits with leading zeros, no sign or decimal point; 0 is "00000000000". */
export function encodeAmount(amount: number | undefined): string {
  return String(Math.round((amount ?? 0) * 100)).padStart(11, "0");
}

/** Fields 10 and 14, Standard 5.2: "DD.MM.LLLL". Takes YYYY-MM-DD. */
export function encodeDate(date: string | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y}`;
}

/** Fields 3, 4 and 11, Standard 5.2: "Velika črka »X« ali prazno." */
const flag = (on: boolean | undefined) => (on ? "X" : "");

/** The 19 strings of fields 1–19, as they go into the QR code. Assumes validated fields. */
export function rawFields(fields: UpnFields): string[] {
  const raw = [LEADING_STYLE];
  for (const def of FIELDS) {
    const value = fields[def.name];
    switch (def.kind) {
      case "flag":
        raw.push(flag(value as boolean | undefined));
        break;
      case "amount":
        raw.push(encodeAmount(value as number | undefined));
        break;
      case "date":
        raw.push(encodeDate(value as string | undefined));
        break;
      case "iban":
        // Standard 5.2, fields 2 and 15: "brez presledkov" (without spaces).
        raw.push(value ? normalizeIban(value as string) : "");
        break;
      case "reference":
        // Standard 5.2, fields 5 and 16: "Model in sklic skupaj brez presledkov."
        raw.push(value ? normalizeReference(value as string) : "");
        break;
      default:
        raw.push((value as string | undefined) ?? "");
    }
  }
  return raw;
}

/** The QR payload: fields 1–20, each with its LF separator. */
export function encodeUpn(fields: UpnFields): { payload: string; bytes: Uint8Array } {
  const raw = rawFields(fields);
  const payload = [...raw, lengthChecksum(raw)].map((f) => f + SEPARATOR).join("");
  return { payload, bytes: encodeLatin2(payload) };
}
