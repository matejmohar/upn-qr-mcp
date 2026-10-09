/**
 * The fields of a UPN QR code.
 *
 * Source: Združenje bank Slovenije, "UPN QR – tehnični standard", verzija 1.1, november 2016, section 5.2
 * "Struktura zapisa kode QR" (also published separately as Priloga 3, "Struktura zapisa QR na obrazcu UPN QR",
 * confirmed 23.6.2016). Cited below as "Standard 5.2". Which fields each kind of order needs comes from
 * "Navodilo o obliki, vsebini in uporabi UPN QR", verzija 1.1, section 4 and Priloga 2 ("Navodilo").
 */

/** The fields as tools see them: readable names, dates as YYYY-MM-DD, the amount in euros. */
export interface UpnFields {
  /** IBAN plačnika (field 2). */
  payerIban?: string;
  /** Polog, cash deposit (field 3). */
  deposit?: boolean;
  /** Dvig, cash withdrawal (field 4). */
  withdrawal?: boolean;
  /** Referenca plačnika (field 5). */
  payerReference?: string;
  /** Ime plačnika (field 6). */
  payerName?: string;
  /** Ulica in št. plačnika (field 7). */
  payerAddress?: string;
  /** Kraj plačnika (field 8), e.g. "2000 Maribor". */
  payerCity?: string;
  /** Znesek in EUR (field 9). */
  amount?: number;
  /** Datum plačila, YYYY-MM-DD (field 10). */
  paymentDate?: string;
  /** Nujno, urgent (field 11). */
  urgent?: boolean;
  /** Koda namena (field 12), e.g. OTHR. */
  purposeCode?: string;
  /** Namen plačila (field 13). */
  purpose?: string;
  /** Rok plačila, YYYY-MM-DD (field 14). */
  dueDate?: string;
  /** IBAN prejemnika (field 15). */
  recipientIban?: string;
  /** Referenca prejemnika (field 16). */
  recipientReference?: string;
  /** Ime prejemnika (field 17). */
  recipientName?: string;
  /** Ulica in št. prejemnika (field 18). */
  recipientAddress?: string;
  /** Kraj prejemnika (field 19). */
  recipientCity?: string;
}

export type FieldName = keyof UpnFields;

export interface FieldDef {
  /** Position in the QR code, 1-based, as numbered in Standard 5.2. */
  position: number;
  name: FieldName;
  /** Slovenian name as printed on the form. */
  label: string;
  /** Maximum length in the QR code (Standard 5.2, "Največja dolžina"). */
  maxLength: number;
  kind: "text" | "iban" | "reference" | "flag" | "amount" | "date" | "purposeCode";
}

/** Field 1, Standard 5.2: "Vodilni slog", the constant "UPNQR". */
export const LEADING_STYLE = "UPNQR";

/** Fields 2–19 in QR order. Field 1 is LEADING_STYLE, field 20 the checksum (checksum.ts). */
export const FIELDS: readonly FieldDef[] = [
  { position: 2, name: "payerIban", label: "IBAN plačnika", maxLength: 19, kind: "iban" },
  { position: 3, name: "deposit", label: "Polog", maxLength: 1, kind: "flag" },
  { position: 4, name: "withdrawal", label: "Dvig", maxLength: 1, kind: "flag" },
  { position: 5, name: "payerReference", label: "Referenca plačnika", maxLength: 26, kind: "reference" },
  { position: 6, name: "payerName", label: "Ime plačnika", maxLength: 33, kind: "text" },
  { position: 7, name: "payerAddress", label: "Ulica in št. plačnika", maxLength: 33, kind: "text" },
  { position: 8, name: "payerCity", label: "Kraj plačnika", maxLength: 33, kind: "text" },
  { position: 9, name: "amount", label: "Znesek", maxLength: 11, kind: "amount" },
  { position: 10, name: "paymentDate", label: "Datum plačila", maxLength: 10, kind: "date" },
  { position: 11, name: "urgent", label: "Nujno", maxLength: 1, kind: "flag" },
  { position: 12, name: "purposeCode", label: "Koda namena", maxLength: 4, kind: "purposeCode" },
  { position: 13, name: "purpose", label: "Namen plačila", maxLength: 42, kind: "text" },
  { position: 14, name: "dueDate", label: "Rok plačila", maxLength: 10, kind: "date" },
  { position: 15, name: "recipientIban", label: "IBAN prejemnika", maxLength: 34, kind: "iban" },
  { position: 16, name: "recipientReference", label: "Referenca prejemnika", maxLength: 26, kind: "reference" },
  { position: 17, name: "recipientName", label: "Ime prejemnika", maxLength: 33, kind: "text" },
  { position: 18, name: "recipientAddress", label: "Ulica in št. prejemnika", maxLength: 33, kind: "text" },
  { position: 19, name: "recipientCity", label: "Kraj prejemnika", maxLength: 33, kind: "text" },
];

export const FIELD_BY_NAME: Readonly<Record<FieldName, FieldDef>> = Object.fromEntries(FIELDS.map((f) => [f.name, f])) as Record<FieldName, FieldDef>;

/** Field 9, Standard 5.2: "Največji znesek, ki ga lahko vpišemo, je 999.999.999,99 (ena milijarda - 1)." In cents: */
export const MAX_AMOUNT_CENTS = 99_999_999_999;

/**
 * Standard 5.2, note (*): the QR code (version 15, byte mode, ECC M, ECI ISO 8859-2) holds 411 characters;
 * fields 1–20 with their separators take at most 411 and the optional reserve (rezerva) the rest.
 */
export const MAX_PAYLOAD_LENGTH = 411;

/**
 * The four uses of the form (Navodilo, 1 and 4): plačilo obveznosti (payment), plačilo obveznosti
 * registriranih izdajateljev (payment order of a registered issuer), polog gotovine (cash deposit) and
 * dvig gotovine (cash withdrawal).
 */
export const ORDER_TYPES = ["payment", "registered_issuer", "deposit", "withdrawal"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export type Rule = "required" | "optional" | "forbidden";

/** Name, street and city of the payer ("payer") and of the recipient ("recipient") share one rule. */
export type RuleKey = Exclude<FieldName, "payerName" | "payerAddress" | "payerCity" | "recipientName" | "recipientAddress" | "recipientCity"> | "payer" | "recipient";

/**
 * Which fields each use needs. Navodilo, Priloga 2 ("Navodila za izpolnjevanje posameznih polj pri različnih
 * namenih uporabe UPN QR") and sections 4.1.1, 4.2.1, 4.3.1 and 4.4.1. Name, street and city are one field
 * on the form ("Ime, ulica in kraj"), so the rule applies to all three.
 *
 * Footnotes: (1) and (2) payer data and amount are optional for registered issuers (e.g. charities), so
 * they are "optional" here; (3) the recipient's reference is required for payments of taxes and other public
 * revenues (JFP), which this server can't tell from the data, so it is "optional" with a warning in validate.ts.
 */
export const RULES: Readonly<Record<OrderType, Readonly<Record<RuleKey, Rule>>>> = {
  payment: {
    payerIban: "optional",
    deposit: "forbidden",
    withdrawal: "forbidden",
    payerReference: "optional",
    payer: "required",
    amount: "required",
    paymentDate: "optional",
    urgent: "optional",
    purposeCode: "required",
    purpose: "required",
    dueDate: "optional",
    recipientIban: "required",
    recipientReference: "optional",
    recipient: "required",
  },
  registered_issuer: {
    payerIban: "forbidden",
    deposit: "forbidden",
    withdrawal: "forbidden",
    payerReference: "forbidden",
    payer: "optional",
    amount: "optional",
    paymentDate: "forbidden",
    urgent: "forbidden",
    purposeCode: "required",
    purpose: "required",
    dueDate: "optional",
    recipientIban: "required",
    recipientReference: "required",
    recipient: "required",
  },
  deposit: {
    payerIban: "forbidden",
    deposit: "required",
    withdrawal: "forbidden",
    payerReference: "forbidden",
    payer: "optional",
    amount: "required",
    paymentDate: "required",
    urgent: "forbidden",
    purposeCode: "required",
    purpose: "required",
    dueDate: "forbidden",
    recipientIban: "required",
    recipientReference: "optional",
    recipient: "required",
  },
  withdrawal: {
    payerIban: "required",
    deposit: "forbidden",
    withdrawal: "required",
    payerReference: "optional",
    payer: "required",
    amount: "required",
    paymentDate: "required",
    urgent: "forbidden",
    purposeCode: "required",
    purpose: "required",
    dueDate: "forbidden",
    recipientIban: "forbidden",
    recipientReference: "forbidden",
    recipient: "optional",
  },
};

export const ORDER_TYPE_LABELS: Readonly<Record<OrderType, string>> = {
  payment: "payment order (nalog za plačilo obveznosti)",
  registered_issuer: "payment order of a registered issuer (nalog za plačilo obveznosti registriranih izdajateljev)",
  deposit: "cash deposit (nalog za polog gotovine)",
  withdrawal: "cash withdrawal (nalog za dvig gotovine)",
};
