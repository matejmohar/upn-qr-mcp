import { describe, expect, it } from "vitest";
import { buildReference, mod11CheckDigit, rfCheckDigits, SI_MODELS, validateReference } from "../src/reference.js";

describe("mod-11 check digit (ZBS reference rules v1.4, Priloga 3)", () => {
  it("matches the worked examples", () => {
    // a) 102674 → 7, b) 14 → 0 (sum divisible by 11, discouraged), c) 54 → 0 (result 10)
    expect(mod11CheckDigit("102674")).toEqual({ digit: 7, discouraged: false });
    expect(mod11CheckDigit("14")).toEqual({ digit: 0, discouraged: true });
    expect(mod11CheckDigit("54")).toEqual({ digit: 0, discouraged: false });
  });

  it("weights at most 12 digits", () => {
    expect(mod11CheckDigit("1".repeat(12)).digit).toBeTypeOf("number");
    expect(() => mod11CheckDigit("1".repeat(13))).toThrow(/up to 12 digits/);
  });
});

describe("RF references (ISO 11649, rules v1.4 chapter 3)", () => {
  it("matches the worked examples of Priloga 4 and 5", () => {
    expect(rfCheckDigits("2348231")).toBe("71");
    expect(rfCheckDigits("SBO2010")).toBe("45");
    expect(validateReference("RF71 2348 231")).toEqual({ valid: true, model: "RF", normalized: "RF712348231", errors: [], warnings: [] });
    expect(validateReference("RF45SBO2010").valid).toBe(true);
    expect(validateReference("rf45 sbo2 010").valid).toBe(true);
  });

  it("rejects wrong check digits, characters and lengths", () => {
    expect(validateReference("RF46SBO2010").errors[0]).toMatch(/would be 45/);
    expect(validateReference("RF45SBO-2010").errors[0]).toMatch(/only digits and letters/);
    expect(validateReference("RFAB123").errors[0]).toMatch(/two check digits/);
    expect(validateReference("RF45").errors[0]).toMatch(/no content/);
    const body = "A".repeat(21);
    expect(validateReference(`RF${rfCheckDigits(body)}${body}`).valid).toBe(true);
    const long = "A".repeat(22);
    expect(validateReference(`RF${rfCheckDigits(long)}${long}`).errors[0]).toMatch(/at most 25/);
  });

  it("builds RF references", () => {
    expect(buildReference("RF", ["2348231"]).reference).toBe("RF712348231");
    expect(buildReference("rf", ["SBO2", "010"])).toEqual({ reference: "RF45SBO2010", display: "RF45 SBO2 010", warnings: [] });
    expect(() => buildReference("RF", [])).toThrow(/content/);
  });
});

describe("SI references (rules v1.4 chapter 2)", () => {
  it("accepts the examples in the rules and the UPN QR standard", () => {
    for (const ref of ["SI05 19-1235-84503", "SI0519-1235-84503", "SI12 1033842574531", "SI081236-17-345679", "SI00225268-32526-222", "SI0598765432100", "SI99"]) {
      expect(validateReference(ref), ref).toMatchObject({ valid: true, errors: [] });
    }
    expect(validateReference("si12 1033842574531")).toMatchObject({ model: "SI12", normalized: "SI121033842574531" });
  });

  it("rejects unknown models and malformed content", () => {
    expect(validateReference("SI13123").errors[0]).toMatch(/not a model/);
    expect(validateReference("SIAB123").errors[0]).toMatch(/two-digit model/);
    expect(validateReference("SI00ABC").errors[0]).toMatch(/only digits and hyphens/);
    expect(validateReference("SI001-2-3-4").errors[0]).toMatch(/at most three parts/);
    expect(validateReference("SI001--3").errors[0]).toMatch(/empty/);
    expect(validateReference("SI00").errors[0]).toMatch(/needs at least 1 part/);
    expect(validateReference("SI991").errors[0]).toMatch(/just SI99/);
    expect(validateReference("XX123").errors[0]).toMatch(/starts with SI .* or RF/);
    expect(validateReference("").errors).toEqual(["The reference is empty."]);
  });

  it("checks part counts per model", () => {
    expect(validateReference("SI021-1-1").valid).toBe(false); // P2 "1": check digit of nothing is 0
    expect(validateReference("SI03140-140-140").errors).toEqual([]);
    expect(validateReference("SI03140-140").errors[0]).toMatch(/needs 3 parts/);
    expect(validateReference("SI121033842574531-1").errors[0]).toMatch(/at most 1 part/);
    expect(validateReference("SI2112-3-4").errors[0]).toMatch(/at most 2 parts/);
  });

  it("checks digit counts and leading zeros", () => {
    expect(validateReference(`SI00${"1".repeat(12)}`).valid).toBe(true);
    expect(validateReference(`SI00${"1".repeat(13)}`).errors[0]).toMatch(/P1 has 13 digits/);
    expect(validateReference(`SI00${"1".repeat(12)}-${"1".repeat(8)}`).valid).toBe(true);
    expect(validateReference(`SI00${"1".repeat(12)}-${"1".repeat(9)}`).errors[0]).toMatch(/at most 20 digits/);
    expect(validateReference("SI001-01").errors[0]).toMatch(/without leading zeros/);
    expect(validateReference("SI001-0").valid).toBe(true);
    // Model 12 is exactly 13 digits, padded with leading zeros.
    expect(validateReference("SI1220261047").errors[0]).toMatch(/exactly 13 digits/);
  });

  it("verifies the check digit of every checked part or group", () => {
    expect(validateReference("SI121033842574532").errors[0]).toMatch(/check digit of P1 is 2, but mod 11 of 103384257453 gives 1/);
    expect(validateReference("SI081236-17-345678").errors[0]).toMatch(/P3/);
    expect(validateReference("SI081236-18-345679").errors[0]).toMatch(/P1-P2/);
    expect(validateReference("SI001-2-3").valid).toBe(true); // model 00 has no check digits
  });

  it("warns about a discouraged check digit and about the contradictory models 21 and 31", () => {
    expect(validateReference("SI121234567890120")).toMatchObject({ valid: true, warnings: [expect.stringMatching(/divisible by 11/)] });
    expect(validateReference("SI2119-5")).toMatchObject({ valid: true, warnings: [expect.stringMatching(/contradict/)] });
  });

  it("warns instead of guessing when a group is longer than the weights reach", () => {
    const r = validateReference("SI0112345678901-2345678-0");
    expect(r.valid).toBe(true);
    expect(r.warnings[0]).toMatch(/can't be verified/);
  });

  it("builds a reference for every model", () => {
    for (const [no, model] of Object.entries(SI_MODELS)) {
      const parts = ["123", "45", "67"].slice(0, model.required);
      if (no === "99") {
        expect(buildReference("SI99", []).reference).toBe("SI99");
        continue;
      }
      const built = buildReference(`SI${no}`, parts);
      expect(validateReference(built.reference), `SI${no} → ${built.reference}`).toMatchObject({ valid: true, errors: [] });
    }
  });

  it("builds the documented examples", () => {
    expect(buildReference("SI12", ["2026104"])).toEqual({ reference: "SI120000020261047", display: "SI12 0000020261047", warnings: [] });
    expect(buildReference("12", ["103384257453"]).reference).toBe("SI121033842574531");
    expect(buildReference("SI05", ["1", "1235", "84503"]).reference).toBe("SI0519-1235-84503");
    expect(buildReference("SI08", ["1236", "1", "34567"]).reference).toBe("SI081236-17-345679");
    expect(buildReference("SI01", ["1", "2"]).reference).toBe("SI011-24");
  });

  it("refuses what it can't build", () => {
    expect(() => buildReference("SI13", ["1"])).toThrow(/Unknown model/);
    expect(() => buildReference("SI03", ["1", "2"])).toThrow(/takes 3 parts/);
    expect(() => buildReference("SI12", ["1234567890123"])).toThrow(/at most 12 digits/);
    expect(() => buildReference("SI00", ["12a"])).toThrow(/digits only/);
    expect(() => buildReference("SI00", ["1", "02"])).toThrow(/leading zeros/);
    expect(() => buildReference("SI01", ["123456789012", "3"])).toThrow(/up to 12 digits/);
  });

  it("warns when the built check digit is discouraged", () => {
    expect(buildReference("SI12", ["123456789012"]).warnings[0]).toMatch(/divisible by 11/);
  });
});
