import { describe, expect, it } from "vitest";
import { formatIban, mod97, validateIban } from "../src/iban.js";
import { AT_IBAN, DE_IBAN, GB_IBAN, SI_IBAN, SI_IBAN_91002, SI_IBAN_NLB } from "./data.js";

describe("validateIban", () => {
  it("accepts valid IBANs and normalises spaces and case", () => {
    expect(validateIban(GB_IBAN)).toEqual({ valid: true, normalized: GB_IBAN, country: "GB", errors: [] });
    expect(validateIban("si56 9900 0001 2345 646")).toEqual({ valid: true, normalized: SI_IBAN, country: "SI", errors: [] });
    expect(validateIban(DE_IBAN).valid).toBe(true);
    expect(validateIban(AT_IBAN).valid).toBe(true);
  });

  it("names the Slovenian bank from the Bank of Slovenia's codes, two- or five-digit", () => {
    expect(validateIban(SI_IBAN_NLB).bankName).toBe("NLB D.D.");
    expect(validateIban(SI_IBAN_91002).bankName).toBe("DINARO D.O.O.");
    // Bank code 99 isn't assigned: no name rather than a guess.
    expect(validateIban(SI_IBAN)).not.toHaveProperty("bankName");
  });

  it("rejects a wrong check digit or a typo", () => {
    const wrongCheck = validateIban(SI_IBAN.replace("SI56", "SI57"));
    expect(wrongCheck.valid).toBe(false);
    expect(wrongCheck.errors[0]).toMatch(/check digits don't match/);
    // Two digits swapped.
    expect(validateIban("SI56990000012345664").valid).toBe(false);
    expect(validateIban(GB_IBAN.replace("WEST", "WEXT")).valid).toBe(false);
  });

  it("checks the Slovenian length", () => {
    expect(validateIban(`${SI_IBAN}0`).errors[0]).toMatch(/19 characters/);
    expect(validateIban(SI_IBAN.slice(0, -1)).errors[0]).toMatch(/19 characters/);
  });

  it("rejects malformed input", () => {
    expect(validateIban("").errors).toEqual(["The IBAN is empty."]);
    expect(validateIban("SI56-0510").errors[0]).toMatch(/only letters/);
    expect(validateIban("5605100801").errors[0]).toMatch(/two-letter country code/);
    expect(validateIban(`GB82${"1".repeat(31)}`).errors[0]).toMatch(/at most 34/);
    expect(validateIban("12345").country).toBeUndefined();
  });

  it("formats in groups of four", () => {
    expect(formatIban("SI56051008010486080")).toBe("SI56 0510 0801 0486 080");
    expect(formatIban("it20a0604558680000000563000")).toBe("IT20 A060 4558 6800 0000 0563 000");
  });

  it("computes mod 97 on numbers longer than a double can hold", () => {
    const n = "3214282912345698765432161182";
    expect(mod97(n)).toBe(Number(BigInt(n) % 97n));
  });
});
