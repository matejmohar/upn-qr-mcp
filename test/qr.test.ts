import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { encodeQr, QrError, scanImage, sniffImageType, toPng, toSvg } from "../src/qr.js";
import { decodeLatin2, encodeLatin2 } from "../src/upn/charset.js";
import { decodeUpn } from "../src/upn/decode.js";
import { encodeUpn } from "../src/upn/encode.js";
import type { UpnFields } from "../src/upn/fields.js";
import { BILL, DE_IBAN, SI_IBAN_2 } from "./data.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/zbs/${name}`, import.meta.url));
const OFFICIAL = JSON.parse(fixture("payloads.json").toString("utf8")) as Record<string, string>;

async function roundTrip(fields: UpnFields): Promise<UpnFields> {
  const { bytes } = encodeUpn(fields);
  const codes = await scanImage(toPng(encodeQr(bytes)));
  expect(codes).toHaveLength(1);
  return decodeUpn(decodeLatin2(codes[0]!.bytes)).fields;
}

describe("QR generation", () => {
  it("makes a version 15 symbol (77 × 77 modules)", () => {
    const matrix = encodeQr(encodeUpn(BILL).bytes);
    expect(matrix.version).toBe(15);
    expect(matrix.size).toBe(77);
  });

  it("uses version 15 even for little data, and refuses more than fits", () => {
    expect(encodeQr(encodeLatin2("UPNQR\n")).version).toBe(15);
    expect(encodeQr(new Uint8Array(411)).version).toBe(15);
    expect(() => encodeQr(new Uint8Array(412))).toThrow(QrError);
  });

  it("writes a PNG with a 4-module quiet zone", () => {
    const png = toPng(encodeQr(encodeUpn(BILL).bytes), 4);
    expect(sniffImageType(png)).toBe("image/png");
    const width = Buffer.from(png).readUInt32BE(16);
    expect(width).toBe(85 * 4);
    expect(() => toPng(encodeQr(encodeUpn(BILL).bytes), 0)).toThrow(/scale/);
  });

  it("writes an SVG that prints at the standard's size", () => {
    const svg = toSvg(encodeQr(encodeUpn(BILL).bytes));
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="35.98333mm" height="35.98333mm" viewBox="0 0 85 85"/);
    expect(svg).toMatch(/<path fill="#000" d="M4 4h7v1h-7z/); // top-left finder pattern, after the quiet zone
    expect(svg.endsWith("</svg>")).toBe(true);
  });
});

describe("QR reading", () => {
  it("reads the codes with the parameters the standard requires: version 15, level M, ECI", async () => {
    const [code] = await scanImage(toPng(encodeQr(encodeUpn(BILL).bytes)));
    expect(code).toMatchObject({ version: "15", ecLevel: "M", hasEci: true });
  });

  for (const name of ["cover", "a", "b", "c", "d", "e", "f", "g", "h"]) {
    it(`reads the official example ${name}`, async () => {
      const codes = await scanImage(fixture(`example-${name}.png`));
      expect(decodeLatin2(codes[0]!.bytes)).toBe(OFFICIAL[name]);
      expect(codes[0]).toMatchObject({ version: "15", ecLevel: "M", hasEci: true });
    });
  }

  it("reads a JPEG photo, rotated", async () => {
    const jpeg = fixture("example-g-photo.jpg");
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    const codes = await scanImage(jpeg);
    expect(decodeLatin2(codes[0]!.bytes)).toBe(OFFICIAL.g);
  });

  it("finds nothing in an image without a QR code", async () => {
    const blank = toPng({ size: 21, version: 1, modules: Array.from({ length: 21 }, () => Array<boolean>(21).fill(false)) });
    expect(await scanImage(blank)).toEqual([]);
  });
});

describe("round trip: generate, read, compare", () => {
  it("keeps every field of a bill, Slovenian letters included", async () => {
    const back = await roundTrip(BILL);
    expect(back).toEqual({ ...BILL, recipientReference: "SI120000020261047" });
  });

  it("keeps a cross-border order with RF references, flags and both dates", async () => {
    const fields: UpnFields = {
      payerIban: SI_IBAN_2,
      payerReference: "RF712348231",
      payerName: "Žiga Čuk",
      payerAddress: "Ulica Šercerjeve brigade 3",
      payerCity: "6000 Koper",
      amount: 999999999.99,
      paymentDate: "2026-10-09",
      urgent: true,
      purposeCode: "SUBS",
      purpose: "Letna naročnina ĆĐŠŽČ ćđšžč",
      dueDate: "2026-12-31",
      recipientIban: DE_IBAN,
      recipientReference: "RF45SBO2010",
      recipientName: "Beispiel GmbH",
      recipientAddress: "Musterstraße 15",
      recipientCity: "DE-80331 München",
    };
    expect(await roundTrip(fields)).toEqual(fields);
  });

  it("keeps the smallest and the longest values", async () => {
    const longest: UpnFields = { ...BILL, payerName: "Ž".repeat(33), purpose: "č".repeat(42), recipientCity: "Đ".repeat(33), amount: 0.01 };
    expect(await roundTrip(longest)).toEqual({ ...longest, recipientReference: "SI120000020261047" });
  });
});
