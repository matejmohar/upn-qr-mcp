/**
 * The printed UPN QR form as a PDF: the layout of the paper form, filled in with the order's data and its QR code.
 *
 * Source: "UPN QR – tehnični standard", verzija 1.1, November 2016 ("Standard"):
 *   - 1 (210 × 99 mm), 3 and 3.1–3.2.2 (what is printed where, fonts, colours);
 *   - Tabela 1 "Koordinate ter višina in širina polj glede na dokument": every field's corners, in mm from the
 *     form's top left corner (the A-numbers below are the table's);
 *   - 4.2.2: machine filling in Courier New bold, 12 cpi on the order and 17 cpi recommended on the receipt;
 *     amounts, dates, IBANs and references formatted;
 *   - 5.1: the QR code, 35,98 mm with its quiet zone;
 *   - 6.2 "UPN QR A4 z dopisom": on A4 the form takes the bottom 99 mm and the space above is for a letter.
 *
 * Substitutions, because the standard's fonts can't be bundled: Source Sans 3 Semibold (Adobe, SIL OFL) for Myriad
 * Pro Semibold, and Liberation Mono Bold (SIL OFL), which has Courier New's metrics, for Courier New Bold. Colours
 * are the sRGB values of the standard's own artwork (its cover), since the standard names Pantone inks only
 * (172 U, 116 U at 20 %, black).
 *
 * This draws the layout; it doesn't make a certified form. ZBS has printers and issuers check their forms with its
 * authorised company before issuing them ("Postopki tiskanja, izdaje in plačila z obrazcem UPN QR", points 1–10),
 * and paper forms are printed on OCR paper (Standard 2).
 */
import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import pdfLib, { type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { formatIban } from "./iban.js";
import { PRINTED_SIZE_MM, QUIET_ZONE_MODULES, type QrMatrix } from "./qr.js";
import type { UpnFields } from "./upn/fields.js";
import { formatFields } from "./upn/format.js";

const { PDFDocument, rgb } = pdfLib;

export type Paper = "a4" | "form";
export const PAPERS: readonly Paper[] = ["a4", "form"];

/** Standard 1. */
const FORM_WIDTH = 210;
const FORM_HEIGHT = 99;
/** Standard 6.2: an A4 sheet with the form at the bottom. */
const A4_HEIGHT = 297;

const PT_PER_MM = 72 / 25.4;

/** sRGB of the standard's artwork: PANTONE 172 U (text and borders), its 20 % raster (payer), PANTONE 116 U at 20 % (recipient), black. */
const RED = rgb(243 / 255, 99 / 255, 42 / 255);
const PAYER_TINT = rgb(253 / 255, 220 / 255, 198 / 255);
const RECIPIENT_TINT = rgb(254 / 255, 244 / 255, 201 / 255);
const BLACK = rgb(35 / 255, 31 / 255, 32 / 255);
const WHITE = rgb(1, 1, 1);
const DATA = rgb(0, 0, 0);

/** Standard 4.2.2: 12 characters per inch on the order, 17 on the receipt. Liberation Mono, like Courier New, advances 0,6 em. */
const ORDER_SIZE = 25.4 / 12 / 0.6 / 25.4 * 72;
const RECEIPT_SIZE = 25.4 / 17 / 0.6 / 25.4 * 72;

type Box = readonly [x1: number, y1: number, x2: number, y2: number];

/** Tabela 1, receipt (POTRDILO). */
const RECEIPT = {
  payer: [4.0, 6.0, 56.5, 19.5], // A3
  purpose: [4.0, 22.5, 56.5, 31.5], // A5
  amount: [16.5, 34.5, 56.5, 39.5], // A8
  recipientAccount: [4.0, 42.5, 56.5, 56.0], // A10
  recipient: [4.0, 59.0, 56.5, 72.5], // A12
} satisfies Record<string, Box>;

/** Tabela 1, order (NALOG). */
const ORDER = {
  payerIban: [106.5, 6.0, 177.7, 11.0], // A22
  deposit: [185.2, 6.5, 189.2, 10.5], // A23
  withdrawal: [196.5, 6.5, 200.5, 10.5], // A24
  qr: [63.5, 6.0, 103.5, 45.5], // A25
  payerReference1: [106.5, 14.0, 121.5, 19.0], // A27
  payerReference2: [123.5, 14.0, 206.0, 19.0], // A28
  payer: [106.5, 22.0, 206.0, 37.0], // A30
  amount: [114.2, 40.5, 155.5, 45.5], // A37
  paymentDate: [161.2, 40.5, 191.2, 45.5], // A38
  urgent: [196.5, 41.0, 200.5, 45.0], // A39
  purposeCode: [63.5, 49.0, 78.5, 54.0], // A43
  purpose: [80.5, 49.0, 174.2, 54.0], // A44
  dueDate: [176.2, 49.0, 206.0, 54.0], // A45
  recipientIban: [63.5, 58.0, 191.0, 63.0], // A47
  recipientReference1: [63.5, 66.0, 78.5, 71.0], // A50
  recipientReference2: [80.5, 66.0, 163.0, 71.0], // A51
  signature: [166.0, 66.0, 206.0, 89.0], // A52
  recipient: [63.5, 74.0, 163.0, 89.0], // A54
} satisfies Record<string, Box>;

/** Tabela 1: fields ruled for hand filling, one character per 3,75 mm (A45: 3,72 mm). */
const COMBED: readonly [Box, number][] = [
  [ORDER.payerIban, 3.75],
  [ORDER.payerReference1, 3.75],
  [ORDER.payerReference2, 3.75],
  [ORDER.amount, 3.75],
  [ORDER.paymentDate, 3.75],
  [ORDER.purposeCode, 3.75],
  [ORDER.purpose, 3.75],
  [ORDER.dueDate, 3.72],
  [ORDER.recipientIban, 3.75],
  [ORDER.recipientReference1, 3.75],
  [ORDER.recipientReference2, 3.75],
];

/** Tabela 1, A31/A32 and A55/A56: dashed lines between the name, street and town lines. */
const DASHED: readonly [x1: number, x2: number, y: number][] = [
  [106.5, 206.0, 27.0],
  [106.5, 206.0, 32.0],
  [63.5, 163.0, 79.0],
  [63.5, 163.0, 84.0],
];

/** Tabela 1, A15, A16, A62: marks for scanning and alignment. */
const MARKS: readonly Box[] = [
  [61.0, 1.0, 62.5, 2.5],
  [207.5, 1.0, 209.0, 2.5],
  [207.5, 96.5, 209.0, 98.0],
];

interface Label {
  text: string;
  /** Left edge and bottom of the text's box in Tabela 1 (or its right edge, when `right`). */
  x: number;
  y: number;
  size?: number;
  black?: boolean;
  right?: boolean;
}

/** Tabela 1 and 3.1–3.2.2: the printed texts. Myriad Pro (here Source Sans 3) Semibold, 7 pt red unless noted. */
const LABELS: readonly Label[] = [
  { text: "UPN QR - potrdilo", x: 56.5, y: 4.9, size: 10, black: true, right: true }, // A1
  { text: "Ime plačnika", x: 4.0, y: 5.8 }, // A2
  { text: "Namen in rok plačila", x: 4.0, y: 22.2 }, // A4
  { text: "Znesek", x: 16.5, y: 33.8 }, // A6
  { text: "EUR", x: 7.8, y: 38.3, size: 11, black: true }, // A7
  { text: "IBAN in referenca prejemnika", x: 4.0, y: 42.3 }, // A9
  { text: "Ime prejemnika", x: 4.0, y: 58.8 }, // A11
  { text: "Prostor za vpise ponudnika plačilnih storitev", x: 13.8, y: 98.6, size: 6 }, // A14
  { text: "Koda QR", x: 63.5, y: 5.5 }, // A17
  { text: "IBAN plačnika", x: 106.5, y: 5.7 }, // A18
  { text: "Polog", x: 184.3, y: 5.7 }, // A19
  { text: "Dvig", x: 196.1, y: 5.7 }, // A20
  { text: "Referenca plačnika", x: 106.5, y: 13.8 }, // A26
  { text: "Ime, ulica in kraj plačnika", x: 106.5, y: 21.8 }, // A29
  // A33: Tabela 1 gives its top (41,6) only; its baseline sits as far above the field's bottom as A7's does above A8's.
  { text: "EUR", x: 106.5, y: 44.3, size: 11, black: true },
  { text: "Znesek", x: 114.2, y: 39.8 }, // A34
  { text: "Datum plačila", x: 161.2, y: 40.2 }, // A35
  { text: "Nujno", x: 195.3, y: 40.2 }, // A36
  { text: "Koda namena", x: 63.5, y: 48.3 }, // A40
  { text: "Namen plačila", x: 80.5, y: 48.7 }, // A41
  { text: "Rok plačila", x: 176.2, y: 48.7 }, // A42
  { text: "IBAN prejemnika", x: 63.5, y: 57.8 }, // A46
  { text: "UPN QR", x: 206.0, y: 61.9, size: 10, black: true, right: true }, // A48
  { text: "Referenca prejemnika", x: 63.5, y: 65.8 }, // A49
  { text: "Ime, ulica in kraj prejemnika", x: 63.5, y: 73.8 }, // A53
  { text: "Podpis plačnika (neobvezno žig)", x: 172.0, y: 88.0, size: 6 }, // A58
  { text: "Prostor za vpise ponudnika plačilnih storitev", x: 118.9, y: 98.6, size: 5 }, // A60
];

/** Text boxes in Tabela 1 run from the top of the capitals to the bottom of the descenders; the baseline sits this far above the bottom. */
const LABEL_DESCENT = 0.45;
/** Data starts this far into its field. */
const PADDING = 1.0;

const fontPath = (name: string) => new URL(`../fonts/${name}`, import.meta.url);
let fontFiles: { label: Uint8Array; data: Uint8Array } | undefined;

function loadFonts() {
  fontFiles ??= {
    label: readFileSync(fontPath("SourceSans3-Semibold.ttf")),
    data: readFileSync(fontPath("LiberationMono-Bold.ttf")),
  };
  return fontFiles;
}

export interface FormOptions {
  /** "a4" (default): an A4 page with the form at the bottom, as in Standard 6.2. "form": a 210 × 99 mm page. */
  paper?: Paper;
  title?: string;
}

/** Draws the UPN QR form for already validated fields and their QR code. */
export async function renderForm(fields: UpnFields, qr: QrMatrix, options: FormOptions = {}): Promise<Uint8Array> {
  const paper = options.paper ?? "a4";
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const files = loadFonts();
  const labelFont = await doc.embedFont(files.label, { subset: true });
  const dataFont = await doc.embedFont(files.data, { subset: true });
  doc.setTitle(options.title ?? "UPN QR");
  doc.setProducer("upn-qr-mcp");
  doc.setCreator("upn-qr-mcp");

  const pageHeight = paper === "a4" ? A4_HEIGHT : FORM_HEIGHT;
  const page = doc.addPage([FORM_WIDTH * PT_PER_MM, pageHeight * PT_PER_MM]);
  const draw = new Drawer(page, pageHeight - FORM_HEIGHT, pageHeight);

  drawLayout(draw, labelFont);
  drawQr(draw, qr);
  drawData(draw, dataFont, fields);
  return doc.save({ useObjectStreams: true });
}

/** Coordinates in mm from the form's top left corner, as in Tabela 1. */
class Drawer {
  constructor(
    readonly page: PDFPage,
    private readonly top: number,
    private readonly pageHeight: number,
  ) {}

  x(mm: number) {
    return mm * PT_PER_MM;
  }

  y(mm: number) {
    return (this.pageHeight - this.top - mm) * PT_PER_MM;
  }

  rect([x1, y1, x2, y2]: Box, fill: RGB | undefined, border?: RGB) {
    this.page.drawRectangle({
      x: this.x(x1),
      y: this.y(y2),
      width: (x2 - x1) * PT_PER_MM,
      height: (y2 - y1) * PT_PER_MM,
      ...(fill ? { color: fill } : {}),
      ...(border ? { borderColor: border, borderWidth: 0.5 } : { borderWidth: 0 }),
    });
  }

  line(x1: number, y1: number, x2: number, y2: number, thickness: number, color: RGB, dash?: number[]) {
    this.page.drawLine({ start: { x: this.x(x1), y: this.y(y1) }, end: { x: this.x(x2), y: this.y(y2) }, thickness, color, ...(dash ? { dashArray: dash } : {}) });
  }

  text(text: string, x: number, baseline: number, font: PDFFont, size: number, color: RGB) {
    this.page.drawText(text, { x: this.x(x), y: this.y(baseline), font, size, color });
  }
}

function drawLayout(draw: Drawer, font: PDFFont) {
  // Standard 3: the payer's part of the order on a 20 % raster of PANTONE 172 U, the recipient's on 20 % PANTONE 116 U.
  // The artwork splits them 55 mm from the top (the text's 50 + 44 mm leaves 5 mm unaccounted for).
  draw.rect([60, 0, FORM_WIDTH, 55], PAYER_TINT);
  draw.rect([60, 55, FORM_WIDTH, FORM_HEIGHT], RECIPIENT_TINT);

  for (const box of [...Object.values(RECEIPT), ...Object.values(ORDER)]) draw.rect(box, WHITE, RED);
  for (const [[x1, , x2, y2], pitch] of COMBED) {
    for (let x = x1 + pitch; x < x2 - 0.5; x += pitch) draw.line(x, y2, x, y2 - 1.25, 0.5, RED);
  }
  // A31/A32, A55/A56: dashes of 0,5 pt with gaps of 0,2 pt, 0,25 pt thick.
  for (const [x1, x2, y] of DASHED) draw.line(x1, y, x2, y, 0.25, RED, [0.5, 0.2]);
  // A57: the signature line, 0,5 pt.
  draw.line(168.6, 85.3, 203.3, 85.3, 0.5, RED);
  for (const mark of MARKS) draw.rect(mark, BLACK);

  for (const label of LABELS) {
    const size = label.size ?? 7;
    const x = label.right ? label.x - font.widthOfTextAtSize(label.text, size) / PT_PER_MM : label.x;
    draw.text(label.text, x, label.y - LABEL_DESCENT, font, size, label.black ? BLACK : RED);
  }
}

/** Standard 5.1: the code with its quiet zone is 35,98 mm square; it is centred in A25. */
function drawQr(draw: Drawer, qr: QrMatrix) {
  const [x1, y1, x2, y2] = ORDER.qr;
  const module = PRINTED_SIZE_MM / (qr.size + 2 * QUIET_ZONE_MODULES);
  const left = x1 + (x2 - x1 - PRINTED_SIZE_MM) / 2 + QUIET_ZONE_MODULES * module;
  const top = y1 + (y2 - y1 - PRINTED_SIZE_MM) / 2 + QUIET_ZONE_MODULES * module;
  qr.modules.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (!row[x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end]) end++;
      draw.rect([left + x * module, top + y * module, left + end * module, top + (y + 1) * module], DATA);
      x = end;
    }
  });
}

function drawData(draw: Drawer, font: PDFFont, fields: UpnFields) {
  const f = formatFields(fields);
  const order = (box: Box, text: string | undefined, line = 0, lineHeight = 5) => {
    if (text) fit(draw, font, text, box, ORDER_SIZE, box[1] + (line + 1) * lineHeight - 1.5);
  };
  const receipt = (box: Box, text: string | undefined, line = 0) => {
    if (text) fit(draw, font, text, box, RECEIPT_SIZE, box[1] + (line + 1) * 4.5 - 1.5);
  };
  const tick = (box: Box, on: boolean | undefined) => {
    if (!on) return;
    const [x1, y1, x2, y2] = box;
    draw.line(x1 + 0.6, y1 + 0.6, x2 - 0.6, y2 - 0.6, 1, DATA);
    draw.line(x1 + 0.6, y2 - 0.6, x2 - 0.6, y1 + 0.6, 1, DATA);
  };
  const payer = [fields.payerName, fields.payerAddress, fields.payerCity];
  const recipient = [fields.recipientName, fields.recipientAddress, fields.recipientCity];

  // Receipt (3.1). The ZBS example puts the IBAN on the first line of A10 and the reference on the last, and runs the
  // purpose on into the due date ("…, 25.06.2016"), wrapping as needed.
  payer.forEach((text, i) => receipt(RECEIPT.payer, text, i));
  wrap([fields.purpose, f.dueDate].filter(Boolean).join(", "), maxChars(RECEIPT.purpose, RECEIPT_SIZE), 2).forEach((text, i) => receipt(RECEIPT.purpose, text, i));
  receipt(RECEIPT.amount, f.amount);
  receipt(RECEIPT.recipientAccount, f.recipientIban, 0);
  receipt(RECEIPT.recipientAccount, f.recipientReference, 2);
  recipient.forEach((text, i) => receipt(RECEIPT.recipient, text, i));

  // Order (3.2). References are split into the model (A27, A50) and the rest (A28, A51).
  order(ORDER.payerIban, f.payerIban);
  tick(ORDER.deposit, fields.deposit);
  tick(ORDER.withdrawal, fields.withdrawal);
  const [payerModel, payerRest] = splitReference(f.payerReference);
  order(ORDER.payerReference1, payerModel);
  order(ORDER.payerReference2, payerRest);
  payer.forEach((text, i) => order(ORDER.payer, text, i));
  order(ORDER.amount, f.amount);
  order(ORDER.paymentDate, f.paymentDate);
  tick(ORDER.urgent, fields.urgent);
  order(ORDER.purposeCode, fields.purposeCode);
  order(ORDER.purpose, fields.purpose);
  order(ORDER.dueDate, f.dueDate);
  order(ORDER.recipientIban, f.recipientIban);
  const [recipientModel, recipientRest] = splitReference(f.recipientReference);
  order(ORDER.recipientReference1, recipientModel);
  order(ORDER.recipientReference2, recipientRest);
  recipient.forEach((text, i) => order(ORDER.recipient, text, i));
}

function splitReference(formatted: string | undefined): [string | undefined, string | undefined] {
  if (!formatted) return [undefined, undefined];
  if (formatted.startsWith("RF")) {
    const compact = formatted.replace(/ /g, "");
    return [compact.slice(0, 4), formatIban(compact).slice(5)];
  }
  return [formatted.slice(0, 4), formatted.slice(5)];
}

function maxChars([x1, , x2]: Box, size: number): number {
  return Math.floor((x2 - x1 - 2 * PADDING) / ((size * 0.6) / PT_PER_MM));
}

/** Writes text left-aligned in a field; if it is too wide (a long foreign IBAN on the receipt), it is set smaller to fit. */
function fit(draw: Drawer, font: PDFFont, text: string, [x1, , x2]: Box, size: number, baseline: number) {
  const room = (x2 - x1 - 2 * PADDING) * PT_PER_MM;
  const width = font.widthOfTextAtSize(text, size);
  draw.text(text, x1 + PADDING, baseline, font, width > room ? (size * room) / width : size, DATA);
}

/** Word-wraps to at most `lines` lines of `width` characters, breaking long words; the last line takes the rest. */
export function wrap(text: string, width: number, lines: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest && out.length < lines - 1 && rest.length > width) {
    let cut = rest.lastIndexOf(" ", width);
    if (cut <= 0) cut = width;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}
