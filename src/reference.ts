/**
 * Payment references: Slovenian SI references (models SI00–SI99) and ISO 11649 RF creditor references.
 *
 * Source: Združenje bank Slovenije, "Pravila za oblikovanje in uporabo standardiziranih referenc pri
 * opravljanju plačilnih storitev", verzija 1.4, november 2023 (in force from 1.12.2023), cited below as
 * "Pravila 1.4". Section numbers refer to that document.
 */
import { lettersToDigits, mod97 } from "./iban.js";

export interface ReferenceResult {
  valid: boolean;
  /** "SI00" … "SI99", or "RF"; undefined when the prefix isn't recognised. */
  model?: string;
  /** Electronic form: no spaces, prefix in upper case. What goes into the QR code. */
  normalized: string;
  errors: string[];
  /** Things that don't make the reference invalid but are worth telling the user. */
  warnings: string[];
}

interface SiModel {
  /** Groups of part indexes (0 = P1) that share one check digit K, the last digit of the group's last part. */
  checks: number[][];
  /** Number of parts (P) required and allowed. Pravila 1.4, 2.2, columns "Obvezno" and "Dovoljeno". */
  required: number;
  allowed: number;
  note?: string;
}

/**
 * The models of Pravila 1.4, 2.2 (table "Modeli za zapis reference"). "(P1) K" means P1 carries its own
 * check digit, "(P1 - P2) K" one check digit over P1 and P2 together.
 */
export const SI_MODELS: Readonly<Record<string, SiModel>> = {
  "00": { checks: [], required: 1, allowed: 3 },
  "01": { checks: [[0, 1, 2]], required: 1, allowed: 3 },
  "02": { checks: [[1], [2]], required: 3, allowed: 3 },
  "03": { checks: [[0], [1], [2]], required: 3, allowed: 3 },
  "04": { checks: [[0], [2]], required: 3, allowed: 3 },
  "05": { checks: [[0]], required: 1, allowed: 3 },
  "06": { checks: [[1, 2]], required: 2, allowed: 3 },
  "07": { checks: [[1]], required: 2, allowed: 3 },
  "08": { checks: [[0, 1], [2]], required: 3, allowed: 3 },
  "09": { checks: [[0, 1]], required: 1, allowed: 3 },
  "10": { checks: [[0], [1, 2]], required: 2, allowed: 3 },
  "11": { checks: [[0], [1]], required: 2, allowed: 3 },
  // Pravila 1.4, 2.2: model 12 has P1 only, 13 digits including K; Priloga 1: shorter data is padded with leading zeros.
  "12": { checks: [[0]], required: 1, allowed: 1 },
  "18": { checks: [[0], [1]], required: 2, allowed: 3 },
  "19": { checks: [[0], [1]], required: 2, allowed: 3 },
  // Models 21 and 31: the table shows "(P1) K - (P2)" (no K on P2), and so does the 2016 version of the rules
  // ("Model 21 in 31 se uporabljata, ko ima podatek P1 kontrolno številko. Podatek P2 nima kontrolne številke."),
  // but the text of 2.2.1 in version 1.4 lists them among the models where P1 and P2 both have a check digit.
  // TODO: confirm with ZBS. Until then P2 is not checked, as in the table.
  "21": { checks: [[0]], required: 2, allowed: 2, note: "P2's check digit isn't verified: the ZBS rules (v1.4) contradict themselves for this model." },
  "22": { checks: [[0]], required: 2, allowed: 2, note: "Model 22 is used only by the Financial Administration (FURS) for SEPA direct debits." },
  "23": { checks: [[0], [1]], required: 2, allowed: 2 },
  "28": { checks: [[0], [1]], required: 2, allowed: 3 },
  "31": { checks: [[0]], required: 2, allowed: 2, note: "P2's check digit isn't verified: the ZBS rules (v1.4) contradict themselves for this model." },
  "32": { checks: [[0]], required: 2, allowed: 2, note: "Model 32 is used only by the Financial Administration (FURS) for SEPA direct debits." },
  "38": { checks: [[0], [1]], required: 2, allowed: 3 },
  "40": { checks: [[0], [1]], required: 2, allowed: 3 },
  "41": { checks: [[0], [1]], required: 2, allowed: 3 },
  "48": { checks: [[0], [1]], required: 2, allowed: 3 },
  "49": { checks: [[0], [1]], required: 2, allowed: 3 },
  "51": { checks: [[0], [1]], required: 2, allowed: 3 },
  "55": { checks: [[0]], required: 1, allowed: 3 },
  "58": { checks: [[0], [1]], required: 2, allowed: 3, note: "Model 58 is used only for the single treasury account's liquidity management." },
  "99": { checks: [], required: 0, allowed: 0 },
};

/** Pravila 1.4, 2.2: one part has at most 12 digits (model 12: 13), all parts together at most 20, at most two hyphens. */
const MAX_PART_DIGITS = 12;
const MODEL_12_DIGITS = 13;
const MAX_TOTAL_DIGITS = 20;
/** Pravila 1.4, Priloga 3: weights run from 2 (rightmost) to 13, so at most 12 digits can be weighted. */
const MAX_WEIGHTED_DIGITS = 12;
/** Pravila 1.4, 3: RF, two check digits, then the 5th to 25th character. */
const RF_MAX_BODY = 21;

export class ReferenceError extends Error {}

/**
 * Mod-11 check digit. Pravila 1.4, Priloga 3: digits are weighted 2, 3, … 13 from the right, the products
 * summed, the remainder of the sum divided by 11 subtracted from 11; a result of 10 or 11 gives 0. A result of 11
 * (sum divisible by 11) "se ne priporoča" (is not recommended), reported as `discouraged`.
 */
export function mod11CheckDigit(data: string): { digit: number; discouraged: boolean } {
  if (!/^[0-9]*$/.test(data)) throw new ReferenceError("Only digits can have a mod-11 check digit.");
  if (data.length > MAX_WEIGHTED_DIGITS) {
    throw new ReferenceError(`The ZBS rules only define weights for up to ${MAX_WEIGHTED_DIGITS} digits; this has ${data.length}.`);
  }
  let sum = 0;
  [...data].reverse().forEach((d, i) => (sum += Number(d) * (i + 2)));
  const result = 11 - (sum % 11);
  return { digit: result >= 10 ? 0 : result, discouraged: result === 11 };
}

/** ISO 11649 check digits for an RF reference body. Pravila 1.4, 3.2 and Priloga 4: append RF00, letters to numbers, 98 − (mod 97). */
export function rfCheckDigits(body: string): string {
  return String(98 - mod97(lettersToDigits(`${body.toUpperCase()}RF00`))).padStart(2, "0");
}

export function normalizeReference(input: string): string {
  const compact = input.replace(/\s+/g, "");
  return compact.slice(0, 2).toUpperCase() + compact.slice(2);
}

export function validateReference(input: string): ReferenceResult {
  const normalized = normalizeReference(input);
  const prefix = normalized.slice(0, 2);
  if (prefix === "SI") return validateSi(normalized);
  if (prefix === "RF") return validateRf(normalized);
  return {
    valid: false,
    normalized,
    errors: [normalized ? "A reference starts with SI (Slovenian models SI00–SI99) or RF (ISO 11649 creditor reference)." : "The reference is empty."],
    warnings: [],
  };
}

function validateRf(normalized: string): ReferenceResult {
  const errors: string[] = [];
  const result = (): ReferenceResult => ({ valid: errors.length === 0, model: "RF", normalized, errors, warnings: [] });
  const check = normalized.slice(2, 4);
  const body = normalized.slice(4);
  if (!/^[0-9]{2}$/.test(check)) errors.push("After RF come two check digits, e.g. RF45 SBO2 010.");
  // Pravila 1.4, 3: "Dovoljeni znaki: številke od 0 do 9; male in velike črke od A do Z"; no hyphens, spaces or other characters.
  if (!body) errors.push("The RF reference has no content after its check digits.");
  else if (!/^[A-Za-z0-9]+$/.test(body)) errors.push("An RF reference has only digits and letters A-Z after its check digits: no hyphens or other characters.");
  if (body.length > RF_MAX_BODY) errors.push(`An RF reference has at most 25 characters (RF, 2 check digits and up to ${RF_MAX_BODY} more); this one has ${normalized.length}.`);
  if (errors.length) return result();
  // Pravila 1.4, Priloga 5: move the first four characters to the end, letters to numbers, remainder mod 97 must be 1.
  if (mod97(lettersToDigits(`${body.toUpperCase()}RF${check}`)) !== 1) {
    errors.push(`The check digits don't match the reference: for ${body} they would be ${rfCheckDigits(body)} (ISO 11649).`);
  }
  return result();
}

function validateSi(normalized: string): ReferenceResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const modelNo = normalized.slice(2, 4);
  const model = SI_MODELS[modelNo];
  const result = (): ReferenceResult => ({
    valid: errors.length === 0,
    ...(/^[0-9]{2}$/.test(modelNo) ? { model: `SI${modelNo}` } : {}),
    normalized,
    errors,
    warnings,
  });
  if (!/^[0-9]{2}$/.test(modelNo)) {
    errors.push("After SI comes the two-digit model number, e.g. SI12.");
    return result();
  }
  if (!model) {
    errors.push(`SI${modelNo} is not a model of the ZBS reference rules (v1.4). Models: ${Object.keys(SI_MODELS).map((m) => `SI${m}`).join(", ")}.`);
    return result();
  }
  if (model.note) warnings.push(model.note);

  const content = normalized.slice(4);
  if (modelNo === "99") {
    // Pravila 1.4, 2.2.1: "Model 99 se uporablja brez podatkov P1, P2 in P3."
    if (content) errors.push("Model SI99 has no content: the reference is just SI99.");
    return result();
  }
  if (!content) {
    errors.push(`Model SI${modelNo} needs at least ${model.required} part${model.required > 1 ? "s" : ""} after the model number.`);
    return result();
  }
  // Pravila 1.4, 2.1: positions 5–26, up to 20 digits and at most two hyphens.
  if (!/^[0-9-]+$/.test(content)) {
    errors.push("An SI reference has only digits and hyphens after the model number, e.g. SI05 19-1235-84503.");
    return result();
  }
  const parts = content.split("-");
  if (parts.length > 3) errors.push("An SI reference has at most three parts (P1-P2-P3), so at most two hyphens.");
  if (parts.some((p) => p === "")) errors.push("A part of the reference is empty: check for a leading, trailing or double hyphen.");
  if (errors.length) return result();

  if (parts.length < model.required) errors.push(`Model SI${modelNo} needs ${model.required === model.allowed ? "" : "at least "}${model.required} part${model.required > 1 ? "s" : ""} (P1-P2-P3); this reference has ${parts.length}.`);
  if (parts.length > model.allowed) errors.push(`Model SI${modelNo} allows at most ${model.allowed} part${model.allowed > 1 ? "s" : ""}; this reference has ${parts.length}.`);

  const digits = parts.join("").length;
  if (digits > MAX_TOTAL_DIGITS) errors.push(`The parts together have at most ${MAX_TOTAL_DIGITS} digits; these have ${digits}.`);
  parts.forEach((p, i) => {
    const max = modelNo === "12" ? MODEL_12_DIGITS : MAX_PART_DIGITS;
    if (p.length > max) errors.push(`P${i + 1} has ${p.length} digits; at most ${max} are allowed.`);
    // Pravila 1.4, 2.2: "Podatka P2 in P3 se vpišeta brez vodilnih ničel."
    if (i > 0 && p.length > 1 && p.startsWith("0")) errors.push(`P${i + 1} (${p}) must be written without leading zeros.`);
  });
  // Pravila 1.4, Priloga 1: "Referenca po modelu 12 mora vsebovati 13 znakov, če je podatek manjši, se dopolni z vodilnimi ničlami."
  if (modelNo === "12" && parts[0]!.length !== MODEL_12_DIGITS) {
    errors.push(`Model SI12 has exactly 13 digits including the check digit (pad with leading zeros); this one has ${parts[0]!.length}.`);
  }
  if (errors.length) return result();

  for (const group of model.checks) {
    const present = group.filter((i) => i < parts.length);
    if (!present.length) continue;
    const label = present.map((i) => `P${i + 1}`).join("-");
    const all = present.map((i) => parts[i]!).join("");
    const data = all.slice(0, -1);
    const given = Number(all.slice(-1));
    let expected: { digit: number; discouraged: boolean };
    try {
      expected = mod11CheckDigit(data);
    } catch (error) {
      // TODO: the rules don't say how to weight more than 12 digits (Priloga 3 stops at weight 13).
      warnings.push(`The check digit of ${label} can't be verified: ${(error as Error).message}`);
      continue;
    }
    if (expected.digit !== given) {
      errors.push(`The check digit of ${label} is ${given}, but mod 11 of ${data || "(nothing)"} gives ${expected.digit}: the reference has a typo.`);
    } else if (expected.discouraged) {
      warnings.push(`${label} is valid, but its weighted sum is divisible by 11, which the ZBS rules advise against (Priloga 3).`);
    }
  }
  return result();
}

/**
 * Builds a reference with its check digits. For SI models, `parts` are P1, P2, P3 without check digits;
 * a check digit is appended to the last part of every checked group. For RF, the parts are joined into
 * the reference body.
 */
export function buildReference(modelInput: string, parts: readonly string[]): { reference: string; display: string; warnings: string[] } {
  const model = modelInput.replace(/\s+/g, "").toUpperCase();
  const cleanParts = parts.map((p) => p.replace(/\s+/g, ""));
  if (model === "RF") {
    const body = cleanParts.join("");
    if (!body) throw new ReferenceError("Give the reference content (letters and digits) as parts.");
    const reference = `RF${rfCheckDigits(body)}${body}`;
    return finish(reference, `${reference.replace(/(.{4})(?=.)/g, "$1 ")}`);
  }

  const modelNo = model.replace(/^SI/, "");
  const def = SI_MODELS[modelNo];
  if (!/^[0-9]{2}$/.test(modelNo) || !def) {
    throw new ReferenceError(`Unknown model "${modelInput}". Use RF or an SI model: ${Object.keys(SI_MODELS).map((m) => `SI${m}`).join(", ")}.`);
  }
  if (cleanParts.length < def.required || cleanParts.length > def.allowed) {
    const n = def.required === def.allowed ? `${def.required}` : `${def.required} to ${def.allowed}`;
    throw new ReferenceError(`Model SI${modelNo} takes ${n} part${def.allowed === 1 ? "" : "s"}; got ${cleanParts.length}.`);
  }
  for (const p of cleanParts) {
    if (!/^[0-9]+$/.test(p)) throw new ReferenceError(`Parts of an SI reference are digits only; "${p}" isn't.`);
  }
  const built = [...cleanParts];
  // Pravila 1.4, Priloga 1: model 12 is padded with leading zeros to 12 digits plus the check digit.
  if (modelNo === "12") {
    if (built[0]!.length > MODEL_12_DIGITS - 1) throw new ReferenceError("Model SI12 takes at most 12 digits before its check digit.");
    built[0] = built[0]!.padStart(MODEL_12_DIGITS - 1, "0");
  }
  const warnings: string[] = [];
  for (const group of def.checks) {
    const present = group.filter((i) => i < built.length);
    if (!present.length) continue;
    const data = present.map((i) => built[i]!).join("");
    const { digit, discouraged } = mod11CheckDigit(data);
    const last = present.at(-1)!;
    built[last] = `${built[last]}${digit}`;
    if (discouraged) {
      warnings.push(`The weighted sum of ${present.map((i) => `P${i + 1}`).join("-")} is divisible by 11, which the ZBS rules advise against (Priloga 3); consider a different number.`);
    }
  }
  const reference = `SI${modelNo}${built.join("-")}`;
  return finish(reference, `SI${modelNo} ${built.join("-")}`, warnings);

  function finish(reference: string, display: string, extra: string[] = []) {
    const check = validateReference(reference);
    if (!check.valid) throw new ReferenceError(check.errors.join(" "));
    return { reference, display, warnings: [...new Set([...extra, ...check.warnings])] };
  }
}
