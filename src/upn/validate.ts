/**
 * Checks UPN fields against the standard.
 *
 * Sources: "UPN QR – tehnični standard", verzija 1.1, 5.2 ("Standard 5.2") for lengths and formats of each
 * field; "Navodilo o obliki, vsebini in uporabi UPN QR", verzija 1.1, section 4 and Priloga 2 ("Navodilo")
 * for which fields each kind of order needs; the ZBS reference rules v1.4 for references (reference.ts).
 */
import { validateIban } from "../iban.js";
import { validateReference } from "../reference.js";
import { describeCharacter, invalidCharacters, latin2Length } from "./charset.js";
import type { FieldError } from "./decode.js";
import { FIELD_BY_NAME, MAX_AMOUNT_CENTS, ORDER_TYPE_LABELS, RULES, type FieldName, type OrderType, type RuleKey, type UpnFields } from "./fields.js";
import { findPurposeCode } from "./purpose-codes.js";

export type { FieldError };

export interface ValidationResult {
  valid: boolean;
  /** The kind of order the fields were checked as. */
  orderType: OrderType;
  errors: FieldError[];
  /** Not errors, but worth telling the user (e.g. a purpose code missing from the ZBS list). */
  warnings: string[];
}

export interface ValidateOptions {
  /** Check as this kind of order. When omitted: deposit or withdrawal when that box is ticked, otherwise a payment order. */
  orderType?: OrderType;
  /**
   * When guessing the kind of order, treat one without payer or amount as a registered issuer's order (charities
   * print those). Used when reading a code someone else made; never when generating one.
   */
  inferRegisteredIssuer?: boolean;
}

const PAYER = ["payerName", "payerAddress", "payerCity"] as const satisfies readonly FieldName[];
const RECIPIENT = ["recipientName", "recipientAddress", "recipientCity"] as const satisfies readonly FieldName[];

function isFilled(fields: UpnFields, name: FieldName): boolean {
  const value = fields[name];
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  // Standard 5.2, field 9: an empty amount is written as zero, so zero counts as not filled in.
  if (typeof value === "number") return value !== 0;
  return value !== "";
}

export function inferOrderType(fields: UpnFields, options: ValidateOptions = {}): OrderType {
  if (options.orderType) return options.orderType;
  if (fields.deposit && !fields.withdrawal) return "deposit";
  if (fields.withdrawal && !fields.deposit) return "withdrawal";
  if (options.inferRegisteredIssuer && (!isFilled(fields, "payerName") || !isFilled(fields, "amount"))) return "registered_issuer";
  return "payment";
}

/** Strict YYYY-MM-DD that is a real calendar date. */
export function isIsoDate(value: string): boolean {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function validateUpn(fields: UpnFields, options: ValidateOptions = {}): ValidationResult {
  const errors: FieldError[] = [];
  const warnings: string[] = [];
  const add = (field: FieldError["field"], message: string) => errors.push({ field, message });
  const orderType = inferOrderType(fields, options);
  const rules = RULES[orderType];
  const kind = ORDER_TYPE_LABELS[orderType];

  if (fields.deposit && fields.withdrawal) add("orderType", "Polog (deposit) and Dvig (withdrawal) can't both be ticked.");

  // Which fields this kind of order needs (Navodilo, Priloga 2).
  for (const [key, rule] of Object.entries(rules) as [RuleKey, string][]) {
    if (key === "payer" || key === "recipient") {
      const group = key === "payer" ? PAYER : RECIPIENT;
      const who = key === "payer" ? "payer" : "recipient";
      if (rule === "required") {
        for (const name of group) if (!isFilled(fields, name)) add(name, `${FIELD_BY_NAME[name].label} is required for a ${kind}: the ${who}'s name, street and city are all needed.`);
      } else if (rule === "forbidden") {
        for (const name of group) if (isFilled(fields, name)) add(name, `${FIELD_BY_NAME[name].label} must be empty for a ${kind}.`);
      }
      continue;
    }
    const label = FIELD_BY_NAME[key].label;
    if (rule === "required" && !isFilled(fields, key)) {
      add(key, key === "amount" ? `The amount (${label}) is required for a ${kind} and must be more than 0.` : `${label} is required for a ${kind}.`);
    } else if (rule === "forbidden" && isFilled(fields, key)) {
      add(key, `${label} must be empty for a ${kind}.`);
    }
  }
  if (orderType === "payment" && !isFilled(fields, "recipientReference")) {
    // Navodilo, Priloga 2, footnote (3).
    warnings.push("No recipient reference: that's fine for most payments, but taxes and other public revenues (dohodnina, DDV, prispevki, globe, takse …) need one.");
  }

  // Formats of the individual fields (Standard 5.2).
  for (const [name, value] of Object.entries(fields) as [FieldName, unknown][]) {
    const def = FIELD_BY_NAME[name];
    if (!def || value === undefined || value === null || value === "") continue;
    switch (def.kind) {
      case "text":
        checkText(name, value);
        break;
      case "flag":
        if (typeof value !== "boolean") add(name, `${def.label} is true or false.`);
        break;
      case "iban":
        checkIban(name, value);
        break;
      case "reference":
        checkReference(name, value);
        break;
      case "amount":
        checkAmount(value);
        break;
      case "date":
        if (typeof value !== "string" || !isIsoDate(value)) add(name, `${def.label} must be a date written YYYY-MM-DD; got ${JSON.stringify(value)}.`);
        break;
      case "purposeCode":
        checkPurposeCode(value);
        break;
    }
  }
  // In the order of the form, so the user can go through it top to bottom.
  const position = (e: FieldError) => (e.field in FIELD_BY_NAME ? FIELD_BY_NAME[e.field as FieldName].position : 0);
  errors.sort((a, b) => position(a) - position(b));
  return { valid: errors.length === 0, orderType, errors, warnings };

  function checkText(name: FieldName, value: unknown) {
    const def = FIELD_BY_NAME[name];
    if (typeof value !== "string") return add(name, `${def.label} must be text.`);
    // Standard 5.2: "Vsi znaki kodne tabele ISO 8859-2."
    const bad = invalidCharacters(value);
    if (bad.length) {
      add(name, `${def.label} contains characters a UPN QR code can't hold (only ISO 8859-2, the Central European Latin alphabet with č, š, ž, ć, đ …, without line breaks or tabs): ${bad.map(describeCharacter).join(", ")}.`);
    }
    // Standard 5.2: "Brez vodilnih ali sledečih presledkov."
    if (value !== value.trim()) add(name, `${def.label} must not start or end with spaces.`);
    const length = latin2Length(value);
    if (length > def.maxLength) add(name, `${def.label} has ${length} characters; at most ${def.maxLength} fit (${value.slice(0, def.maxLength)}…).`);
  }

  function checkIban(name: FieldName, value: unknown) {
    const def = FIELD_BY_NAME[name];
    if (typeof value !== "string") return add(name, `${def.label} must be text.`);
    const result = validateIban(value);
    for (const e of result.errors) add(name, `${def.label}: ${e}`);
    // Standard 5.2, field 2: "Pravila za SI IBAN"; Navodilo 4.1.1: the payer's account is a Slovenian one.
    if (name === "payerIban" && result.valid && result.country !== "SI") add(name, `${def.label} must be a Slovenian IBAN (SI…).`);
    if (result.valid && result.normalized.length > def.maxLength) add(name, `${def.label} has at most ${def.maxLength} characters.`);
  }

  function checkReference(name: FieldName, value: unknown) {
    const def = FIELD_BY_NAME[name];
    if (typeof value !== "string") return add(name, `${def.label} must be text.`);
    const result = validateReference(value);
    for (const e of result.errors) add(name, `${def.label}: ${e}`);
    for (const w of result.warnings) warnings.push(`${def.label}: ${w}`);
    // Standard 5.2, fields 5 and 16: at most 26 characters (4 + 22).
    if (result.normalized.length > def.maxLength) add(name, `${def.label} has at most ${def.maxLength} characters without spaces.`);
  }

  function checkAmount(value: unknown) {
    if (typeof value !== "number" || !Number.isFinite(value)) return add("amount", "The amount must be a number in euros, e.g. 14.71.");
    if (value < 0) return add("amount", "The amount can't be negative.");
    const cents = Math.round(value * 100);
    if (Math.abs(cents - value * 100) > 1e-6) add("amount", `The amount has at most two decimals (cents); got ${value}.`);
    // Standard 5.2, field 9: at most 999.999.999,99.
    if (cents > MAX_AMOUNT_CENTS) add("amount", "The amount is at most 999,999,999.99 EUR.");
  }

  function checkPurposeCode(value: unknown) {
    // Standard 5.2, field 12: "Velike črke (A-Z)", 4 characters.
    if (typeof value !== "string" || !/^[A-Z]{4}$/.test(value)) {
      return add("purposeCode", `The purpose code (Koda namena) is four capital letters A-Z, e.g. OTHR; got ${JSON.stringify(value)}.`);
    }
    if (!findPurposeCode(value)) {
      warnings.push(`Purpose code ${value} isn't in the ZBS list of purpose codes (2019-08-07); banks may reject it. See the upn://purpose-codes resource.`);
    }
  }
}
