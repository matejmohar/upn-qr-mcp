import pdfLib from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderForm, wrap } from "../src/form.js";
import { encodeQr } from "../src/qr.js";
import { encodeUpn } from "../src/upn/encode.js";
import type { UpnFields } from "../src/upn/fields.js";
import { BILL, DE_IBAN, SI_IBAN_NLB } from "./data.js";

const { PDFDict, PDFDocument, PDFName } = pdfLib;
const MM = 72 / 25.4;

async function render(fields: UpnFields, paper?: "a4" | "form") {
  const bytes = await renderForm(fields, encodeQr(encodeUpn(fields).bytes), { paper, title: "Test" });
  return { bytes, doc: await PDFDocument.load(bytes) };
}

describe("renderForm", () => {
  it("puts the form at the bottom of an A4 page by default (Standard 6.2)", async () => {
    const { bytes, doc } = await render(BILL);
    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(210 * MM, 1);
    expect(height).toBeCloseTo(297 * MM, 1);
    expect(doc.getTitle()).toBe("Test");
  });

  it("makes a 210 × 99 mm page for the form alone (Standard 1)", async () => {
    const { doc } = await render(BILL, "form");
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(210 * MM, 1);
    expect(height).toBeCloseTo(99 * MM, 1);
  });

  it("embeds subsets of the two bundled fonts, so č, ć and đ print", async () => {
    const { bytes, doc } = await render({ ...BILL, payerName: "Đurđa Ćosić Čeh" });
    const fonts = doc.context
      .enumerateIndirectObjects()
      .map(([, object]) => (object instanceof PDFDict ? object.get(PDFName.of("BaseFont")) : undefined))
      .filter((name) => name instanceof PDFName)
      .map((name) => name!.toString().replace(/^\//, "").replace(/-\d+$/, ""));
    expect([...new Set(fonts)].sort()).toEqual(["LiberationMono-Bold", "SourceSans3-Semibold"]);
    expect(bytes.length).toBeLessThan(100_000);
  });

  it("fills every kind of field without failing, a long foreign IBAN and an RF reference too", async () => {
    const { doc } = await render({
      ...BILL,
      payerIban: SI_IBAN_NLB,
      payerReference: "SI00 123456-67890-12345",
      paymentDate: "2026-10-20",
      urgent: true,
      recipientIban: DE_IBAN,
      recipientReference: "RF18 5390 0754 7034",
      purpose: "Plačilo po pogodbi 2026/17 za september",
    });
    expect(doc.getPageCount()).toBe(1);
  });
});

describe("wrap", () => {
  it("breaks at spaces, and inside words only when it has to", () => {
    expect(wrap("Ravn. z odpadki 04/2016 0040098579, 25.06.2016", 34, 2)).toEqual(["Ravn. z odpadki 04/2016", "0040098579, 25.06.2016"]);
    expect(wrap("Kratko", 34, 2)).toEqual(["Kratko"]);
    expect(wrap("A".repeat(40), 34, 2)).toEqual(["A".repeat(34), "A".repeat(6)]);
    expect(wrap("", 34, 2)).toEqual([]);
  });

  it("puts whatever is left on the last line", () => {
    expect(wrap("ena dva tri štiri", 4, 2)).toEqual(["ena", "dva tri štiri"]);
  });
});
