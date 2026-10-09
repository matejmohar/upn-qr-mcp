import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { formatIban, SI_BANKS_SOURCE, validateIban } from "./iban.js";
import { encodeQr, IMAGE_TYPES, QrError, scanImage, sniffImageType, toPng, toSvg, UPN_QR_ECI, UPN_QR_VERSION } from "./qr.js";
import { buildReference, ReferenceError, SI_MODELS, validateReference } from "./reference.js";
import { decodeLatin2 } from "./upn/charset.js";
import { decodeUpn, isUpnPayload, NotUpnError, type FieldError } from "./upn/decode.js";
import { encodeUpn, rawFields } from "./upn/encode.js";
import { FIELDS, MAX_PAYLOAD_LENGTH, ORDER_TYPES, RULES, type OrderType, type UpnFields } from "./upn/fields.js";
import { PURPOSE_CODES, PURPOSE_CODES_SOURCE } from "./upn/purpose-codes.js";
import { validateUpn } from "./upn/validate.js";
import { VERSION } from "./version.js";

export { validateIban } from "./iban.js";
export { buildReference, validateReference } from "./reference.js";
export { decodeUpn } from "./upn/decode.js";
export { encodeUpn } from "./upn/encode.js";
export type { UpnFields } from "./upn/fields.js";
export { validateUpn } from "./upn/validate.js";

const INSTRUCTIONS = [
  "Reads, checks and prepares Slovenian UPN payment orders (univerzalni plačilni nalog) and their UPN QR codes, " +
    "following the Združenje bank Slovenije (ZBS) standard. It never makes a payment: it only prepares and checks payment data, " +
    "which the user pays in their own bank.",
  "read_upn decodes a UPN QR code from a photo or scan (PNG or JPEG) and checks it. generate_upn makes a UPN QR code (PNG and SVG) " +
    "from the fields, after checking them; it refuses invalid data and says what to fix. validate_upn checks fields without making a code.",
  "validate_iban checks an IBAN (and names the Slovenian bank); validate_reference checks a payment reference (SI00–SI99 models or RF); " +
    "build_reference adds the check digits to a reference.",
  "Purpose codes (koda namena, e.g. OTHR, GDSV, SUPP) are in the upn://purpose-codes resource; for an ordinary bill or invoice " +
    "GDSV (goods and services) or OTHR (other) usually fit.",
  "Dates are YYYY-MM-DD; amounts are in euros with up to two decimals. Text fields allow letters of the Slovenian alphabet (č, š, ž …) " +
    "but no emoji or characters outside ISO 8859-2.",
  "Before the user pays, show them the recipient, IBAN, amount, reference and due date, and remind them to check these against the bill.",
  "Users may write in Slovenian: položnica / UPN = payment order, prejemnik = recipient, plačnik = payer, znesek = amount, " +
    "sklic / referenca = reference, rok plačila = due date, namen = purpose, koda namena = purpose code. Reply in the language the user writes in.",
].join(" ");

/** These tools only compute; nothing leaves this computer. */
const OFFLINE = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

interface ToolResult {
  [key: string]: unknown;
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** An error the user or model can act on; its message is shown as is. */
class ToolInputError extends Error {}

/**
 * Runs a tool body; returns its value as JSON text and as structuredContent, or a readable error. The value is
 * round-tripped through JSON so the two match exactly (undefined fields dropped).
 */
async function runStructured(body: () => Promise<Record<string, unknown>> | Record<string, unknown>, extra: ToolResult["content"] = []): Promise<ToolResult> {
  try {
    const text = JSON.stringify(await body());
    return { content: [{ type: "text", text }, ...extra], structuredContent: JSON.parse(text) as Record<string, unknown> };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: describeError(error) }] };
  }
}

function describeError(error: unknown): string {
  if (error instanceof ToolInputError || error instanceof ReferenceError || error instanceof QrError || error instanceof NotUpnError) return error.message;
  if (error instanceof Error) return `Unexpected error: ${error.message}`;
  return `Unexpected error: ${String(error)}`;
}

// ---- Schemas -----------------------------------------------------------------------------------------------

const orderType = z
  .enum(ORDER_TYPES)
  .describe(
    "Kind of order, which decides the required fields: payment (default; an ordinary bill), registered_issuer (orders printed by " +
      "issuers registered with ZBS, e.g. charities; payer and amount may be empty), deposit (polog gotovine), withdrawal (dvig gotovine).",
  );

const upnFieldShape = {
  payerName: z.string().optional().describe("Payer's name (Ime plačnika), max 33 characters."),
  payerAddress: z.string().optional().describe("Payer's street and number (Ulica in št.), max 33."),
  payerCity: z.string().optional().describe("Payer's postcode and town (Kraj), e.g. \"2000 Maribor\", max 33."),
  payerIban: z.string().optional().describe("Payer's Slovenian IBAN (IBAN plačnika). Usually left empty on a bill."),
  payerReference: z.string().optional().describe("Payer's reference (Referenca plačnika), SI or RF. Usually empty."),
  amount: z.number().optional().describe("Amount in EUR (Znesek), e.g. 14.71; at most 999999999.99."),
  paymentDate: z.string().optional().describe("Payment date (Datum plačila), YYYY-MM-DD. Usually empty on a bill."),
  urgent: z.boolean().optional().describe("Urgent payment (Nujno)."),
  deposit: z.boolean().optional().describe("Cash deposit (Polog)."),
  withdrawal: z.boolean().optional().describe("Cash withdrawal (Dvig)."),
  purposeCode: z.string().optional().describe("Purpose code (Koda namena): four capital letters, e.g. OTHR, GDSV, SUPP, RENT; see upn://purpose-codes."),
  purpose: z.string().optional().describe("Purpose (Namen plačila), e.g. \"Račun 2026-104\", max 42 characters."),
  dueDate: z.string().optional().describe("Due date (Rok plačila), YYYY-MM-DD."),
  recipientIban: z.string().optional().describe("Recipient's IBAN (IBAN prejemnika); spaces are ignored."),
  recipientReference: z.string().optional().describe("Recipient's reference (Referenca prejemnika), e.g. SI12 1033842574531 or RF45 SBO2 010; spaces are ignored."),
  recipientName: z.string().optional().describe("Recipient's name (Ime prejemnika), max 33."),
  recipientAddress: z.string().optional().describe("Recipient's street and number, max 33."),
  recipientCity: z.string().optional().describe("Recipient's postcode and town, max 33."),
};

const fieldsOutput = z.object(upnFieldShape);
const fieldError = z.object({ field: z.string().describe("Field name, or payload / checksum / orderType."), message: z.string() });
const warnings = z.array(z.string()).describe("Not errors, but worth telling the user.");

const validateOutput = z.object({
  valid: z.boolean(),
  orderType: z.enum(ORDER_TYPES).describe("The kind of order the fields were checked as."),
  errors: z.array(fieldError),
  warnings,
});

const formattedOutput = z
  .object({
    amount: z.string().optional(),
    payerIban: z.string().optional(),
    recipientIban: z.string().optional(),
    recipientReference: z.string().optional(),
    payerReference: z.string().optional(),
    paymentDate: z.string().optional(),
    dueDate: z.string().optional(),
  })
  .describe("Values as printed on the paper form (e.g. ***1.234,50, SI56 0510 0801 0486 080, 25.06.2026), for showing to the user.");

// ---- Helpers -----------------------------------------------------------------------------------------------

function pickFields(args: Record<string, unknown>): UpnFields {
  const fields: Record<string, unknown> = {};
  for (const def of FIELDS) {
    const value = args[def.name];
    if (value !== undefined && value !== null && value !== "") fields[def.name] = value;
  }
  return fields as UpnFields;
}

/** Navodilo o obliki, vsebini in uporabi UPN QR, 3.2.1: "#.##0,00", printed as "***1.234,50". */
export function formatAmount(amount: number): string {
  const [whole, cents] = amount.toFixed(2).split(".");
  return `***${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${cents}`;
}

/** Navodilo 3.2.2 (DD.MM.LLLL) and 3.2.3–3.2.4 (IBAN in fours; SI reference as model, space, content). */
function formatted(fields: UpnFields): Record<string, string> {
  const out: Record<string, string> = {};
  if (fields.amount !== undefined) out.amount = formatAmount(fields.amount);
  if (fields.payerIban) out.payerIban = formatIban(fields.payerIban);
  if (fields.recipientIban) out.recipientIban = formatIban(fields.recipientIban);
  for (const key of ["payerReference", "recipientReference"] as const) {
    const ref = fields[key] ? validateReference(fields[key]).normalized : undefined;
    if (ref) out[key] = ref.startsWith("RF") ? formatIban(ref) : `${ref.slice(0, 4)} ${ref.slice(4)}`;
  }
  for (const key of ["paymentDate", "dueDate"] as const) {
    const date = fields[key];
    if (date) out[key] = date.split("-").reverse().join(".");
  }
  return out;
}

/** The fields as they will be stored: IBANs and references without spaces, as the QR code has them. */
function normalizedFields(fields: UpnFields): UpnFields {
  const raw = rawFields(fields);
  const out: UpnFields = { ...fields };
  for (const def of FIELDS) {
    if ((def.kind === "iban" || def.kind === "reference") && raw[def.position - 1]) (out[def.name] as string) = raw[def.position - 1]!;
  }
  return out;
}

function base64(input: string): Uint8Array {
  const data = input.replace(/^data:[^;,]*;base64,/, "").replace(/\s+/g, "");
  if (!data || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(data)) throw new ToolInputError("image must be the image file encoded as base64.");
  return Buffer.from(data, "base64");
}

// ---- Server ------------------------------------------------------------------------------------------------

export function createServer(): McpServer {
  const server = new McpServer({ name: "upn-qr", version: VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "validate_iban",
    {
      title: "Validate IBAN",
      description:
        "Checks an IBAN with the ISO 13616 check digits (mod 97) and returns it normalised (upper case, no spaces) with its country. " +
        "For a Slovenian IBAN it also checks the length and names the bank, from the Bank of Slovenia's list of bank codes.",
      inputSchema: z.object({ iban: z.string().describe("The IBAN, with or without spaces, e.g. SI56 0510 0801 0486 080.") }),
      outputSchema: z.object({
        valid: z.boolean(),
        normalized: z.string(),
        country: z.string().optional(),
        bankName: z.string().optional().describe(`Slovenian IBANs only. Source: ${SI_BANKS_SOURCE}.`),
        errors: z.array(z.string()),
      }),
      annotations: OFFLINE,
    },
    async ({ iban }) => runStructured(() => ({ ...validateIban(iban) })),
  );

  server.registerTool(
    "validate_reference",
    {
      title: "Validate payment reference",
      description:
        "Checks a payment reference (sklic / referenca): Slovenian SI references by model (SI00–SI99, with their mod-11 check digits) " +
        "per the ZBS reference rules v1.4, and RF creditor references per ISO 11649. Returns the model and the normalised reference.",
      inputSchema: z.object({ reference: z.string().describe("The reference, e.g. SI12 1033842574531, SI05 19-1235-84503 or RF45 SBO2 010.") }),
      outputSchema: z.object({
        valid: z.boolean(),
        model: z.string().optional().describe("SI00 … SI99, or RF."),
        normalized: z.string().describe("Without spaces, as it goes into the QR code."),
        errors: z.array(z.string()),
        warnings,
      }),
      annotations: OFFLINE,
    },
    async ({ reference }) => runStructured(() => ({ ...validateReference(reference) })),
  );

  server.registerTool(
    "build_reference",
    {
      title: "Build payment reference",
      description:
        "Builds a payment reference with its check digits. For an SI model give the parts P1, P2, P3 without check digits (e.g. model SI12, " +
        "parts [\"2026104\"] gives SI12 0000020261047); the check digits are added where the model needs them. For RF give the content " +
        "(letters and digits) and the two ISO 11649 check digits are computed.",
      inputSchema: z.object({
        model: z.string().describe("SI model, e.g. SI12, SI00, SI05 (or just 12), or RF."),
        parts: z.array(z.string()).max(3).describe("SI: P1, P2, P3 (digits, without check digits). RF: the reference content, e.g. [\"INV2026104\"]."),
      }),
      outputSchema: z.object({
        reference: z.string().describe("Electronic form, without spaces: what goes into the QR code."),
        display: z.string().describe("As printed on the form."),
        warnings,
      }),
      annotations: OFFLINE,
    },
    async ({ model, parts }) => runStructured(() => buildReference(model, parts)),
  );

  server.registerTool(
    "validate_upn",
    {
      title: "Validate UPN order",
      description:
        "Checks a UPN payment order's fields against the ZBS UPN QR standard: required fields for the kind of order, lengths, allowed " +
        "characters, amount, dates, purpose code, IBANs and references. Lists every problem with the field it belongs to.",
      inputSchema: z.object({ ...upnFieldShape, orderType: orderType.optional() }),
      outputSchema: validateOutput,
      annotations: OFFLINE,
    },
    async (args) => runStructured(() => ({ ...validateUpn(pickFields(args), { orderType: args.orderType }) })),
  );

  server.registerTool(
    "generate_upn",
    {
      title: "Generate UPN QR code",
      description:
        "Makes a UPN QR code for a payment order: checks the fields first (like validate_upn) and refuses invalid data, then returns the " +
        "QR code's text and the code as PNG (base64, also shown as an image) and SVG (prints at the standard's 36 mm). The code follows " +
        "the ZBS standard (version 15, level M, ISO 8859-2), so Slovenian banking apps can scan it. It prepares payment data only; " +
        "it pays nothing.",
      inputSchema: z.object({
        ...upnFieldShape,
        orderType: orderType.default("payment"),
        pngScale: z.number().int().min(1).max(40).default(4).describe("PNG pixels per QR module (the PNG is 85 × scale pixels). 10 suits print at 600 dpi."),
      }),
      outputSchema: z.object({
        payload: z.string().describe("The text in the QR code (ISO 8859-2 in the code itself)."),
        orderType: z.enum(ORDER_TYPES),
        fields: fieldsOutput.describe("The fields as stored: IBANs and references without spaces."),
        formatted: formattedOutput,
        warnings,
        png: z.string().describe("The QR code as a PNG image, base64."),
        svg: z.string().describe("The QR code as SVG."),
      }),
      annotations: OFFLINE,
    },
    async (args) => {
      try {
        const fields = pickFields(args);
        const check = validateUpn(fields, { orderType: args.orderType });
        if (!check.valid) {
          const lines = check.errors.map((e) => `- ${e.field}: ${e.message}`).join("\n");
          return { isError: true, content: [{ type: "text" as const, text: `No QR code was made; fix these fields first:\n${lines}` }] };
        }
        const { payload, bytes } = encodeUpn(fields);
        if (bytes.length > MAX_PAYLOAD_LENGTH) throw new QrError(`The data is ${bytes.length} characters; a UPN QR code holds ${MAX_PAYLOAD_LENGTH}.`);
        const matrix = encodeQr(bytes);
        const png = Buffer.from(toPng(matrix, args.pngScale)).toString("base64");
        return await runStructured(
          () => ({
            payload,
            orderType: check.orderType,
            fields: normalizedFields(fields),
            formatted: formatted(fields),
            warnings: check.warnings,
            png,
            svg: toSvg(matrix),
          }),
          [{ type: "image", data: png, mimeType: "image/png" }],
        );
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: describeError(error) }] };
      }
    },
  );

  const readResult = z.object({
    fields: fieldsOutput,
    valid: z.boolean().describe("True when the code is well-formed and every field passes the standard's checks."),
    orderType: z.enum(ORDER_TYPES),
    errors: z.array(fieldError),
    warnings,
    formatted: formattedOutput,
    payload: z.string().describe("The QR code's text."),
    qr: z.object({ version: z.string(), ecLevel: z.string(), eci: z.boolean() }).describe("QR parameters found; the standard asks for version 15, level M, ECI."),
  });

  server.registerTool(
    "read_upn",
    {
      title: "Read UPN QR code",
      description:
        "Reads the UPN QR code on a payment order (položnica) from a photo or scan, PNG or JPEG: decodes it (č, š, ž preserved), splits " +
        "it into fields and checks them like validate_upn. Returns the fields with any problems, or an error when the image has no UPN QR code. " +
        "Use it for bills the user wants to pay or file; tell them what's due and when.",
      inputSchema: z.object({
        image: z.string().describe("The image file, base64 (a data: URL works too)."),
        mimeType: z.string().describe("image/png or image/jpeg."),
        orderType: orderType.optional().describe("Check as this kind of order; by default it's worked out from the code."),
      }),
      outputSchema: readResult.extend({
        moreCodes: z.array(readResult).optional().describe("Further UPN QR codes in the same image (e.g. a page with several forms)."),
      }),
      annotations: OFFLINE,
    },
    async ({ image, mimeType, orderType: wanted }) =>
      runStructured(async () => {
        const declared = mimeType.toLowerCase().trim();
        if (!IMAGE_TYPES.includes(declared as (typeof IMAGE_TYPES)[number])) {
          throw new ToolInputError(`Only PNG and JPEG images can be read (image/png or image/jpeg); got ${mimeType}. PDFs aren't supported yet: send a screenshot or photo.`);
        }
        const bytes = base64(image);
        const actual = sniffImageType(bytes);
        if (!actual) throw new ToolInputError("The image data isn't a PNG or JPEG file. Send the file itself, base64-encoded.");

        let codes;
        try {
          codes = await scanImage(bytes);
        } catch (error) {
          throw new ToolInputError(`The image couldn't be read: ${(error as Error).message}`);
        }
        const upn = codes.filter((c) => isUpnPayload(decodeLatin2(c.bytes)) || isUpnPayload(c.text));
        if (!upn.length) {
          throw new ToolInputError(
            codes.length
              ? `The image has ${codes.length} QR code${codes.length > 1 ? "s" : ""}, but no UPN QR code (its text must start with UPNQR).`
              : "No QR code found in the image. Try a sharper, straight photo where the QR code fills more of the picture.",
          );
        }
        const results = upn.map((code) => readOne(code, wanted));
        const [first, ...rest] = results;
        return { ...first!, ...(rest.length ? { moreCodes: rest } : {}) };
      }),
  );

  registerResources(server);
  return server;
}

function readOne(code: Awaited<ReturnType<typeof scanImage>>[number], wanted: OrderType | undefined) {
  const warnings: string[] = [];
  // UPN QR – tehnični standard, 5.1 d: the content is ISO 8859-2 (ECI 4). A code that declares another
  // character set via ECI is read the way it declares, with a warning.
  let payload = decodeLatin2(code.bytes);
  if (code.hasEci && code.text !== payload && isUpnPayload(code.text)) {
    payload = code.text;
    warnings.push("The QR code declares a character set other than ISO 8859-2; some banking apps may misread it.");
  }
  // 5.1 a, c, d.
  if (code.version !== String(UPN_QR_VERSION)) warnings.push(`The QR code is version ${code.version}; the standard requires version ${UPN_QR_VERSION}.`);
  if (code.ecLevel && code.ecLevel !== "M") warnings.push(`The QR code uses error correction level ${code.ecLevel}; the standard requires M.`);
  if (!code.hasEci) warnings.push(`The QR code has no ECI marker; the standard requires ECI ${UPN_QR_ECI} (ISO 8859-2).`);

  const decoded = decodeUpn(payload);
  const check = validateUpn(decoded.fields, { orderType: wanted, inferRegisteredIssuer: true });
  if (!wanted && check.orderType === "registered_issuer") {
    warnings.push("Payer or amount is empty, so this was checked as an order of a registered issuer (e.g. a charity), where that's allowed.");
  }
  // A field the decoder already couldn't read isn't reported again as missing.
  const decodeErrorFields = new Set(decoded.errors.map((e) => e.field));
  const errors: FieldError[] = [...decoded.errors, ...check.errors.filter((e) => !decodeErrorFields.has(e.field))];
  return {
    fields: decoded.fields,
    valid: errors.length === 0,
    orderType: check.orderType,
    errors,
    warnings: [...warnings, ...check.warnings],
    formatted: formatted(decoded.fields),
    payload,
    qr: { version: code.version, ecLevel: code.ecLevel, eci: code.hasEci },
  };
}

function registerResources(server: McpServer): void {
  server.registerResource(
    "purpose-codes",
    "upn://purpose-codes",
    {
      title: "UPN purpose codes",
      description: "Payment purpose codes (koda namena) for the UPN form, from the ZBS list (ISO 20022): code, English and Slovenian name and definition.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ source: PURPOSE_CODES_SOURCE, codes: PURPOSE_CODES }) }],
    }),
  );

  server.registerResource(
    "reference-models",
    "upn://reference-models",
    {
      title: "Payment reference models",
      description: "SI reference models (SI00–SI99) from the ZBS reference rules v1.4: parts required and allowed, and which parts carry a mod-11 check digit.",
      mimeType: "application/json",
    },
    async (uri) => {
      const models = Object.entries(SI_MODELS).map(([no, m]) => ({
        model: `SI${no}`,
        parts: { required: m.required, allowed: m.allowed },
        checkDigits: m.checks.map((g) => g.map((i) => `P${i + 1}`).join("-")),
        ...(m.note ? { note: m.note } : {}),
      }));
      const text = JSON.stringify({
        source: "Združenje bank Slovenije, Pravila za oblikovanje in uporabo standardiziranih referenc pri opravljanju plačilnih storitev, v1.4, November 2023",
        rules:
          "SI + 2-digit model + up to 3 parts P1-P2-P3 separated by hyphens; each part at most 12 digits (SI12: exactly 13), at most 20 digits " +
          "in all; P2 and P3 without leading zeros. A check digit (mod 11, weights 2…13 from the right) is the last digit of its part or group. " +
          "RF: ISO 11649, RF + 2 check digits (mod 97) + up to 21 letters and digits.",
        models,
      });
      return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
    },
  );

  server.registerResource(
    "fields",
    "upn://fields",
    {
      title: "UPN QR fields",
      description: "The 20 fields of a UPN QR code (UPN QR – tehnični standard 5.2) with maximum lengths, and which fields each kind of order requires.",
      mimeType: "application/json",
    },
    async (uri) => {
      const text = JSON.stringify({
        source: "Združenje bank Slovenije, UPN QR – tehnični standard v1.1 (5.2) and Navodilo o obliki, vsebini in uporabi UPN QR v1.1 (Priloga 2)",
        fields: [
          { position: 1, name: "(leading style)", content: "UPNQR" },
          ...FIELDS.map((f) => ({ position: f.position, name: f.name, label: f.label, maxLength: f.maxLength })),
          { position: 20, name: "(checksum)", content: "length of fields 1-19 with separators, 3 digits" },
        ],
        rulesByOrderType: RULES,
      });
      return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
    },
  );
}
