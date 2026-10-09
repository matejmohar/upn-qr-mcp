/**
 * Field 20 of the UPN QR code, the length check.
 *
 * UPN QR – tehnični standard, 5.2, field 20 "Vsota dolžin polj od 1 do 19, skupaj z ločili": 3 digits with
 * leading zeros, Value = strlen(N1+'\n') + strlen(N2+'\n') + … + strlen(N19+'\n'). Lengths count ISO 8859-2
 * bytes, one per character.
 */
import { latin2Length } from "./charset.js";

/** The checksum of fields 1–19 (the raw QR strings, without their separators). */
export function lengthChecksum(fields: readonly string[]): string {
  if (fields.length !== 19) throw new RangeError(`The checksum covers fields 1 to 19; got ${fields.length} fields.`);
  const total = fields.reduce((sum, f) => sum + latin2Length(f) + 1, 0);
  return String(total).padStart(3, "0");
}
