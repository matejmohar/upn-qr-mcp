/**
 * The text of a UPN QR code → UPN fields.
 *
 * UPN QR – tehnični standard, 5.2 "Struktura zapisa kode QR" ("Standard 5.2"). This checks the structure
 * (leading style, separators, fixed formats, checksum); validate.ts checks the content.
 */
import { lengthChecksum } from "./checksum.js";
import { SEPARATOR } from "./encode.js";
import { FIELDS, LEADING_STYLE, MAX_PAYLOAD_LENGTH, type FieldName, type UpnFields } from "./fields.js";
import { latin2Length } from "./charset.js";

export interface FieldError {
  /** A field name, or "payload" / "checksum" for the structure as a whole. */
  field: FieldName | "payload" | "checksum" | "orderType";
  message: string;
}

export interface DecodedUpn {
  fields: UpnFields;
  /** The 20 fields exactly as found in the code (field 1 first). */
  raw: string[];
  /** Text after field 20: the reserve (rezerva), empty or spaces. */
  reserve: string;
  errors: FieldError[];
}

export class NotUpnError extends Error {}

/** Does this look like a UPN QR code at all (as opposed to a malformed one)? Standard 5.2, field 1. */
export function isUpnPayload(text: string): boolean {
  return text.startsWith(LEADING_STYLE + SEPARATOR) || text.startsWith(LEADING_STYLE + "\r\n");
}

export function decodeUpn(payload: string): DecodedUpn {
  if (!isUpnPayload(payload)) {
    throw new NotUpnError(`This is not a UPN QR code: its text doesn't start with "${LEADING_STYLE}" and a line break.`);
  }
  const errors: FieldError[] = [];
  if (payload.includes("\r")) {
    errors.push({ field: "payload", message: "Fields must be separated by LF (0x0A) only; this code uses CR LF." });
    payload = payload.replace(/\r\n/g, SEPARATOR);
  }
  // Standard 5.2: "Na koncu vsakega polja, od zaporedne številke 1 do vključno 20, dodamo ločilo LF."
  const parts = payload.split(SEPARATOR);
  if (parts.length < 21) {
    errors.push({ field: "payload", message: `A UPN QR code has 20 fields, each ending with a line break; this one has ${parts.length - 1}.` });
    while (parts.length < 21) parts.push("");
  }
  const raw = parts.slice(0, 20);
  const reserve = parts.slice(20).join(SEPARATOR);
  // Standard 5.2, note (*): the reserve is "Prazno ali presledki" and has no separator.
  if (!/^ *$/.test(reserve)) {
    errors.push({ field: "payload", message: "After field 20 only spaces may follow (the reserve); this code has more data or extra line breaks." });
  }
  // Standard 5.2, note (*): 411 characters at most.
  const length = latin2Length(payload);
  if (length > MAX_PAYLOAD_LENGTH) {
    errors.push({ field: "payload", message: `A UPN QR code holds at most ${MAX_PAYLOAD_LENGTH} characters; this one has ${length}.` });
  }

  const fields: UpnFields = {};
  for (const def of FIELDS) {
    const value = raw[def.position - 1]!;
    switch (def.kind) {
      case "flag":
        // Standard 5.2, fields 3, 4, 11: "Velika črka »X« ali prazno."
        if (value === "X") (fields[def.name] as boolean) = true;
        else if (value !== "") errors.push({ field: def.name, message: `${def.label} is "X" or empty; found "${value}".` });
        break;
      case "amount":
        // Standard 5.2, field 9: 11 digits, cents with leading zeros.
        if (/^[0-9]{11}$/.test(value)) fields.amount = Number(value) / 100;
        else errors.push({ field: "amount", message: `The amount (Znesek) is 11 digits, in cents with leading zeros (e.g. 00000001471 for 14,71); found "${value}".` });
        break;
      case "date": {
        // Standard 5.2, fields 10 and 14: "DD.MM.LLLL".
        const m = /^([0-9]{2})\.([0-9]{2})\.([0-9]{4})$/.exec(value);
        if (m) (fields[def.name] as string) = `${m[3]}-${m[2]}-${m[1]}`;
        else if (value !== "") errors.push({ field: def.name, message: `${def.label} is written DD.MM.YYYY; found "${value}".` });
        break;
      }
      default:
        if (value !== "") (fields[def.name] as string) = value;
    }
  }

  if (raw[0] !== LEADING_STYLE) errors.push({ field: "payload", message: `Field 1 must be "${LEADING_STYLE}".` });
  // Standard 5.2, field 20: 3 digits, the length of fields 1–19 with their separators.
  const expected = lengthChecksum(raw.slice(0, 19));
  if (raw[19] !== expected) {
    errors.push({
      field: "checksum",
      message: /^[0-9]{3}$/.test(raw[19]!)
        ? `Field 20 (length check) says ${raw[19]}, but fields 1–19 are ${expected} characters long: the code is damaged or was generated incorrectly.`
        : `Field 20 (length check) must be 3 digits; found "${raw[19]}".`,
    });
  }
  return { fields, raw, reserve, errors };
}
