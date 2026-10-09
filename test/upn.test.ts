import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { encodeLatin2, invalidCharacters } from "../src/upn/charset.js";
import { lengthChecksum } from "../src/upn/checksum.js";
import { decodeUpn, NotUpnError } from "../src/upn/decode.js";
import { encodeAmount, encodeUpn } from "../src/upn/encode.js";
import type { OrderType, UpnFields } from "../src/upn/fields.js";
import { validateUpn } from "../src/upn/validate.js";
import { BILL, DE_IBAN, SI_IBAN, SI_IBAN_2 } from "./data.js";

const OFFICIAL = JSON.parse(readFileSync(new URL("./fixtures/zbs/payloads.json", import.meta.url), "utf8")) as Record<string, string>;

const errorsOf = (fields: UpnFields, orderType?: OrderType) => validateUpn(fields, { orderType }).errors;
const fieldsWithErrors = (fields: UpnFields, orderType?: OrderType) => errorsOf(fields, orderType).map((e) => e.field);

describe("official examples from the ZBS standard", () => {
  const expected: Record<string, OrderType> = {
    cover: "payment",
    a: "payment",
    b: "payment",
    c: "registered_issuer",
    d: "registered_issuer",
    e: "deposit",
    f: "withdrawal",
    g: "payment",
    h: "registered_issuer",
  };

  for (const [name, payload] of Object.entries(OFFICIAL)) {
    it(`example ${name}: decodes, validates and encodes back to the same text`, () => {
      const decoded = decodeUpn(payload);
      expect(decoded.errors).toEqual([]);
      const check = validateUpn(decoded.fields, { orderType: expected[name] });
      expect(check.errors).toEqual([]);
      // The examples pad the reserve with spaces; our encoder leaves it empty, otherwise byte for byte the same.
      expect(encodeUpn(decoded.fields).payload).toBe(payload.replace(/ +$/, ""));
    });
  }

  it("reads the fields of the cover example", () => {
    expect(decodeUpn(OFFICIAL.cover!).fields).toEqual({
      payerName: "Janez Novak",
      payerAddress: "Lepa cesta 10",
      payerCity: "2000 Maribor",
      amount: 14.71,
      purposeCode: "SCVE",
      purpose: "Ravn. z odpadki 04/2016 0040098579",
      dueDate: "2016-06-25",
      recipientIban: "SI56051008010486080",
      recipientReference: "SI121033842574531",
      recipientName: "Snaga d.o.o.",
      recipientAddress: "Povšetova ulica 6",
      recipientCity: "1000 Ljubljana",
    });
  });

  it("reads flags, dates and empty amounts", () => {
    expect(decodeUpn(OFFICIAL.e!).fields).toMatchObject({ deposit: true, amount: 280, paymentDate: "2016-11-30" });
    expect(decodeUpn(OFFICIAL.f!).fields).toMatchObject({ withdrawal: true, payerIban: "SI56051008010486080" });
    expect(decodeUpn(OFFICIAL.d!).fields.amount).toBe(0);
    expect(decodeUpn(OFFICIAL.g!).fields).toMatchObject({ payerReference: "RF81352ADD05899", recipientIban: "DE12500105170648489890" });
  });

  it("works out the kind of order from the code when reading", () => {
    expect(validateUpn(decodeUpn(OFFICIAL.d!).fields, { inferRegisteredIssuer: true }).orderType).toBe("registered_issuer");
    expect(validateUpn(decodeUpn(OFFICIAL.e!).fields).orderType).toBe("deposit");
    expect(validateUpn(decodeUpn(OFFICIAL.f!).fields).orderType).toBe("withdrawal");
    expect(validateUpn(decodeUpn(OFFICIAL.cover!).fields).orderType).toBe("payment");
  });
});

describe("encoding (UPN QR – tehnični standard 5.2)", () => {
  it("writes 20 fields with LF separators and the length checksum", () => {
    const { payload, bytes } = encodeUpn(BILL);
    const lines = payload.split("\n");
    expect(lines).toHaveLength(21);
    expect(lines[0]).toBe("UPNQR");
    expect(lines[8]).toBe("00000012345");
    expect(lines[13]).toBe("31.10.2026");
    expect(lines[14]).toBe(SI_IBAN);
    expect(lines[15]).toBe("SI120000020261047"); // spaces removed
    expect(lines[20]).toBe("");
    expect(Number(lines[19])).toBe(payload.length - 4);
    // č, ž, Š are single ISO 8859-2 bytes.
    expect(bytes.length).toBe(payload.length);
    expect(Array.from(encodeLatin2("čšžČŠŽ"))).toEqual([0xe8, 0xb9, 0xbe, 0xc8, 0xa9, 0xae]);
  });

  it("writes amounts in cents with 11 digits", () => {
    expect(encodeAmount(0)).toBe("00000000000");
    expect(encodeAmount(undefined)).toBe("00000000000");
    expect(encodeAmount(14.71)).toBe("00000001471");
    expect(encodeAmount(1268.74)).toBe("00000126874");
    expect(encodeAmount(0.29)).toBe("00000000029"); // 0.29 * 100 is 28.999999999999996
    expect(encodeAmount(999999999.99)).toBe("99999999999");
  });

  it("computes the checksum like the standard's example", () => {
    // Field 20 of the cover example.
    expect(lengthChecksum(OFFICIAL.cover!.split("\n").slice(0, 19))).toBe("198");
    expect(() => lengthChecksum(["UPNQR"])).toThrow(/fields 1 to 19/);
  });

  it("fits the longest allowed fields in 411 characters", () => {
    const longest: UpnFields = {
      payerIban: SI_IBAN,
      payerReference: "SI0012345678901-2345678",
      payerName: "Ž".repeat(33),
      payerAddress: "Ž".repeat(33),
      payerCity: "Ž".repeat(33),
      amount: 999999999.99,
      paymentDate: "2026-10-09",
      urgent: true,
      purposeCode: "OTHR",
      purpose: "č".repeat(42),
      dueDate: "2026-10-31",
      recipientIban: `GB82WEST${"1".repeat(26)}`,
      recipientReference: "SI0012345678901-2345678",
      recipientName: "Ž".repeat(33),
      recipientAddress: "Ž".repeat(33),
      recipientCity: "Ž".repeat(33),
    };
    expect(encodeUpn(longest).bytes.length).toBeLessThanOrEqual(411);
  });
});

describe("decoding errors", () => {
  const cover = OFFICIAL.cover!;
  const replaceField = (payload: string, index: number, value: string) => {
    const parts = payload.split("\n");
    parts[index] = value;
    parts[19] = lengthChecksum(parts.slice(0, 19));
    return parts.join("\n");
  };

  it("refuses text that isn't a UPN QR code", () => {
    expect(() => decodeUpn("https://example.com")).toThrow(NotUpnError);
    expect(() => decodeUpn("BCD\n002\n1\nSCT")).toThrow(/doesn't start with "UPNQR"/);
  });

  it("detects a wrong checksum", () => {
    expect(decodeUpn(cover.replace("\n198\n", "\n199\n")).errors).toEqual([{ field: "checksum", message: expect.stringMatching(/says 199, but fields 1–19 are 198/) }]);
    expect(decodeUpn(cover.replace("\n198\n", "\n19\n")).errors[0]!.message).toMatch(/must be 3 digits/);
  });

  it("detects missing fields, CR LF and data after field 20", () => {
    expect(decodeUpn("UPNQR\nSI56\n").errors.map((e) => e.field)).toContain("payload");
    expect(decodeUpn(cover.replace(/\n/g, "\r\n")).errors[0]!.message).toMatch(/CR LF/);
    expect(decodeUpn(`${cover}extra`).errors[0]!.message).toMatch(/only spaces/);
    expect(decodeUpn(`${cover}${" ".repeat(209)}`).errors).toEqual([]);
    expect(decodeUpn(`${cover}${" ".repeat(210)}`).errors[0]!.message).toMatch(/at most 411/);
  });

  it("detects malformed amounts, dates and flags", () => {
    expect(decodeUpn(replaceField(cover, 8, "14,71")).errors).toEqual([{ field: "amount", message: expect.stringMatching(/11 digits/) }]);
    expect(decodeUpn(replaceField(cover, 13, "2016-06-25")).errors).toEqual([{ field: "dueDate", message: expect.stringMatching(/DD.MM.YYYY/) }]);
    expect(decodeUpn(replaceField(cover, 10, "x")).errors).toEqual([{ field: "urgent", message: expect.stringMatching(/"X" or empty/) }]);
  });
});

describe("validation", () => {
  it("accepts a complete bill", () => {
    expect(validateUpn(BILL)).toEqual({ valid: true, orderType: "payment", errors: [], warnings: [] });
  });

  it("allows Slovenian and other ISO 8859-2 characters, not emoji or line breaks", () => {
    expect(errorsOf({ ...BILL, recipientName: "Čičerika ŠĐŽĆ d.o.o." })).toEqual([]);
    expect(errorsOf({ ...BILL, recipientName: "Gesselshaft äöü ß" })).toEqual([]);
    const emoji = errorsOf({ ...BILL, purpose: "Račun 🍕" });
    expect(emoji).toEqual([{ field: "purpose", message: expect.stringMatching(/"🍕" \(U\+1F355\)/) }]);
    expect(fieldsWithErrors({ ...BILL, payerAddress: "Ulica 1\n2000 Maribor" })).toEqual(["payerAddress"]);
    expect(fieldsWithErrors({ ...BILL, purpose: "Račun €5" })).toEqual(["purpose"]); // no euro sign in ISO 8859-2
    expect(invalidCharacters("ćĆđĐ")).toEqual([]);
  });

  it("checks maximum lengths, counting characters", () => {
    expect(errorsOf({ ...BILL, payerName: "Ž".repeat(33), purpose: "č".repeat(42) })).toEqual([]);
    expect(fieldsWithErrors({ ...BILL, payerName: "Ž".repeat(34) })).toEqual(["payerName"]);
    expect(fieldsWithErrors({ ...BILL, purpose: "a".repeat(43) })).toEqual(["purpose"]);
    expect(fieldsWithErrors({ ...BILL, recipientCity: "1".repeat(34) })).toEqual(["recipientCity"]);
  });

  it("rejects leading and trailing spaces", () => {
    expect(errorsOf({ ...BILL, recipientName: " Primer d.o.o." })[0]!.message).toMatch(/start or end with spaces/);
    expect(fieldsWithErrors({ ...BILL, purpose: "Račun 2026-104 " })).toEqual(["purpose"]);
  });

  it("checks the amount", () => {
    expect(errorsOf({ ...BILL, amount: 999999999.99 })).toEqual([]);
    expect(errorsOf({ ...BILL, amount: 0.01 })).toEqual([]);
    expect(errorsOf({ ...BILL, amount: 1000000000 })[0]!.message).toMatch(/at most 999,999,999.99/);
    expect(errorsOf({ ...BILL, amount: 1.005 })[0]!.message).toMatch(/two decimals/);
    expect(errorsOf({ ...BILL, amount: -5 })[0]!.message).toMatch(/negative/);
    expect(errorsOf({ ...BILL, amount: Number.NaN })[0]!.message).toMatch(/number/);
    // Zero counts as no amount: required for a payment, allowed for a registered issuer.
    expect(errorsOf({ ...BILL, amount: 0 })).toEqual([{ field: "amount", message: expect.stringMatching(/required .* more than 0/) }]);
    expect(errorsOf({ ...BILL, amount: undefined })[0]!.field).toBe("amount");
    expect(errorsOf({ ...BILL, amount: 0 }, "registered_issuer")).toEqual([]);
  });

  it("checks dates", () => {
    expect(errorsOf({ ...BILL, dueDate: "2028-02-29" })).toEqual([]);
    expect(fieldsWithErrors({ ...BILL, dueDate: "2026-02-29" })).toEqual(["dueDate"]);
    expect(fieldsWithErrors({ ...BILL, dueDate: "31.10.2026" })).toEqual(["dueDate"]);
    expect(fieldsWithErrors({ ...BILL, paymentDate: "2026-13-01" })).toEqual(["paymentDate"]);
  });

  it("checks the purpose code", () => {
    expect(fieldsWithErrors({ ...BILL, purposeCode: "gdsv" })).toEqual(["purposeCode"]);
    expect(fieldsWithErrors({ ...BILL, purposeCode: "GDS" })).toEqual(["purposeCode"]);
    expect(fieldsWithErrors({ ...BILL, purposeCode: undefined })).toEqual(["purposeCode"]);
    const unknown = validateUpn({ ...BILL, purposeCode: "ZZZZ" });
    expect(unknown.valid).toBe(true);
    expect(unknown.warnings[0]).toMatch(/ZZZZ isn't in the ZBS list/);
  });

  it("checks IBANs: the payer's must be Slovenian, the recipient's any valid IBAN", () => {
    expect(errorsOf({ ...BILL, recipientIban: DE_IBAN })).toEqual([]);
    expect(errorsOf({ ...BILL, recipientIban: "SI56 9900 0001 2345 646" })).toEqual([]);
    expect(errorsOf({ ...BILL, payerIban: SI_IBAN_2 })).toEqual([]);
    expect(errorsOf({ ...BILL, payerIban: DE_IBAN })[0]!.message).toMatch(/must be a Slovenian IBAN/);
    expect(errorsOf({ ...BILL, recipientIban: SI_IBAN.replace("646", "647") })[0]).toMatchObject({ field: "recipientIban", message: expect.stringMatching(/check digits/) });
  });

  it("checks references", () => {
    expect(errorsOf({ ...BILL, recipientReference: "RF45 SBO2 010", payerReference: "SI00 225268-32526-222" })).toEqual([]);
    expect(errorsOf({ ...BILL, recipientReference: "SI12 0000020261048" })[0]!.field).toBe("recipientReference");
    expect(fieldsWithErrors({ ...BILL, payerReference: "XX123" })).toEqual(["payerReference"]);
    expect(validateUpn({ ...BILL, recipientReference: "SI12 1234567890120" }).warnings[0]).toMatch(/Referenca prejemnika: .*divisible by 11/);
  });

  it("requires the payer's and recipient's name, street and city on a payment", () => {
    expect(fieldsWithErrors({ ...BILL, payerName: undefined, payerCity: "" })).toEqual(["payerName", "payerCity"]);
    expect(fieldsWithErrors({ ...BILL, recipientAddress: undefined })).toEqual(["recipientAddress"]);
    expect(fieldsWithErrors({ ...BILL, recipientIban: undefined, purpose: undefined })).toEqual(["purpose", "recipientIban"]);
  });

  it("warns when a payment has no recipient reference", () => {
    const r = validateUpn({ ...BILL, recipientReference: undefined });
    expect(r.valid).toBe(true);
    expect(r.warnings[0]).toMatch(/taxes and other public revenues/);
  });

  it("applies the rules of a registered issuer's order", () => {
    const charity: UpnFields = { ...BILL, payerName: undefined, payerAddress: undefined, payerCity: undefined, amount: undefined, dueDate: undefined };
    expect(errorsOf(charity, "registered_issuer")).toEqual([]);
    expect(fieldsWithErrors({ ...charity, recipientReference: undefined }, "registered_issuer")).toEqual(["recipientReference"]);
    expect(fieldsWithErrors({ ...charity, urgent: true, paymentDate: "2026-10-09", payerIban: SI_IBAN_2, payerReference: "SI99" }, "registered_issuer")).toEqual([
      "payerIban",
      "payerReference",
      "paymentDate",
      "urgent",
    ]);
  });

  it("applies the rules of a cash deposit", () => {
    const deposit: UpnFields = { ...BILL, deposit: true, paymentDate: "2026-10-09", dueDate: undefined, payerName: undefined, payerAddress: undefined, payerCity: undefined };
    expect(validateUpn(deposit)).toMatchObject({ valid: true, orderType: "deposit" });
    expect(fieldsWithErrors({ ...deposit, paymentDate: undefined })).toEqual(["paymentDate"]);
    expect(fieldsWithErrors({ ...deposit, dueDate: "2026-10-31", urgent: true })).toEqual(["urgent", "dueDate"]);
  });

  it("applies the rules of a cash withdrawal", () => {
    const withdrawal: UpnFields = {
      withdrawal: true,
      payerIban: SI_IBAN_2,
      payerName: "Ana Kovačič",
      payerAddress: "Cesta žrtev 7",
      payerCity: "2000 Maribor",
      amount: 350,
      paymentDate: "2026-10-09",
      purposeCode: "CASH",
      purpose: "Dvig gotovine",
    };
    expect(validateUpn(withdrawal)).toMatchObject({ valid: true, orderType: "withdrawal", warnings: [] });
    expect(fieldsWithErrors({ ...withdrawal, payerIban: undefined })).toEqual(["payerIban"]);
    expect(fieldsWithErrors({ ...withdrawal, recipientIban: SI_IBAN, recipientReference: "SI99" })).toEqual(["recipientIban", "recipientReference"]);
  });

  it("rejects deposit and withdrawal together, and flags on a payment", () => {
    expect(fieldsWithErrors({ ...BILL, deposit: true, withdrawal: true })).toContain("orderType");
    expect(fieldsWithErrors({ ...BILL, deposit: true }, "payment")).toEqual(["deposit"]);
  });
});
