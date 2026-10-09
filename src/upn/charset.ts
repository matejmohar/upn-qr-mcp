/**
 * ISO 8859-2 (Latin-2), the character set of the UPN QR payload.
 *
 * UPN QR – tehnični standard, 5.1 d: "Nabor znakov QR: ISO 8859-2. Obvezna je uporaba Extended Channel
 * Interpretation (ECI value 000004)." Text fields allow "Vsi znaki kodne tabele ISO 8859-2" (5.2).
 *
 * Node's TextDecoder knows ISO 8859-2 (full ICU ships with Node), so the table is derived from it
 * rather than typed in by hand. TextEncoder only does UTF-8, hence the reverse map.
 */

const decoder = new TextDecoder("iso-8859-2", { fatal: true });

/** Byte value of every character ISO 8859-2 can represent. */
const BYTE_OF = new Map<string, number>();
for (let b = 0; b < 256; b++) BYTE_OF.set(decoder.decode(Uint8Array.of(b)), b);

/** Control characters (C0, DEL, C1): not printable, and LF is the field separator. */
export function isControl(byte: number): boolean {
  return byte < 0x20 || (byte >= 0x7f && byte <= 0x9f);
}

/** Characters of `text` that ISO 8859-2 can't represent or that are control characters, without duplicates. */
export function invalidCharacters(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) {
    const byte = BYTE_OF.get(ch);
    if (byte === undefined || isControl(byte)) bad.add(ch);
  }
  return [...bad];
}

/** Encodes text as ISO 8859-2. Throws on characters outside the set; check with invalidCharacters() first. */
export function encodeLatin2(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const byte = BYTE_OF.get(ch);
    if (byte === undefined) throw new RangeError(`"${ch}" (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}) is not in ISO 8859-2`);
    out.push(byte);
  }
  return Uint8Array.from(out);
}

export function decodeLatin2(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Length in ISO 8859-2 bytes, which is what the standard's field lengths and checksum count. One byte per character. */
export function latin2Length(text: string): number {
  return [...text].length;
}

/** A readable name for a character in an error message, e.g. "€ (U+20AC)". */
export function describeCharacter(ch: string): string {
  const code = `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
  return /\p{C}/u.test(ch) ? code : `"${ch}" (${code})`;
}
