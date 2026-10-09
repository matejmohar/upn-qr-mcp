/**
 * End-to-end: a real MCP Client talks to the server in-process.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { encodeQr, toPng } from "../src/qr.js";
import { createServer, formatAmount } from "../src/server.js";
import { encodeLatin2 } from "../src/upn/charset.js";
import { encodeUpn } from "../src/upn/encode.js";
import { BILL, SI_IBAN, SI_IBAN_NLB } from "./data.js";

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function connect() {
  const handler = createMcpHandler(() => createServer());
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const client = new Client({ name: "test", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(transport);
  cleanup = async () => {
    await client.close();
    await handler.close();
  };
  return client;
}

type CallResult = Awaited<ReturnType<Client["callTool"]>>;

function json(result: CallResult): any {
  const block = (result.content as { type: string; text: string }[])[0]!;
  return JSON.parse(block.text);
}

function text(result: CallResult): string {
  return (result.content as { type: string; text: string }[])[0]!.text;
}

const fixture = (name: string) => readFileSync(new URL(`./fixtures/zbs/${name}`, import.meta.url));

describe("MCP server", () => {
  it("lists the tools, all offline and read-only except the one that can save a PDF", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["build_reference", "generate_upn", "generate_upn_form", "read_upn", "validate_iban", "validate_reference", "validate_upn"]);
    for (const tool of tools) {
      const readOnly = tool.name !== "generate_upn_form";
      expect(tool.annotations, tool.name).toMatchObject({ readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false });
      expect(tool.outputSchema, tool.name).toBeDefined();
    }
  });

  it("lists the tools in manifest.json", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as { tools: { name: string }[] };
    expect(manifest.tools.map((t) => t.name).sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it("validate_iban", async () => {
    const client = await connect();
    const ok = await client.callTool({ name: "validate_iban", arguments: { iban: "si56 0200 0000 0000 068" } });
    expect(ok.structuredContent).toEqual({ valid: true, normalized: SI_IBAN_NLB, country: "SI", bankName: "NLB D.D.", errors: [] });
    expect(json(ok)).toEqual(ok.structuredContent);
    const bad = await client.callTool({ name: "validate_iban", arguments: { iban: "SI56 0200 0000 0000 069" } });
    expect(bad.structuredContent).toMatchObject({ valid: false, errors: [expect.stringMatching(/check digits/)] });
  });

  it("validate_reference and build_reference", async () => {
    const client = await connect();
    const valid = await client.callTool({ name: "validate_reference", arguments: { reference: "SI12 1033842574531" } });
    expect(valid.structuredContent).toEqual({ valid: true, model: "SI12", normalized: "SI121033842574531", errors: [], warnings: [] });
    const built = await client.callTool({ name: "build_reference", arguments: { model: "SI12", parts: ["2026104"] } });
    expect(built.structuredContent).toEqual({ reference: "SI120000020261047", display: "SI12 0000020261047", warnings: [] });
    const rf = await client.callTool({ name: "build_reference", arguments: { model: "RF", parts: ["2348231"] } });
    expect(rf.structuredContent).toMatchObject({ reference: "RF712348231" });
    const refused = await client.callTool({ name: "build_reference", arguments: { model: "SI13", parts: ["1"] } });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toMatch(/Unknown model "SI13"/);
  });

  it("validate_upn lists every problem with its field", async () => {
    const client = await connect();
    const ok = await client.callTool({ name: "validate_upn", arguments: { ...BILL } });
    expect(ok.structuredContent).toEqual({ valid: true, orderType: "payment", errors: [], warnings: [] });
    const bad = await client.callTool({ name: "validate_upn", arguments: { ...BILL, amount: 0, recipientIban: "SI56 1234", purposeCode: "xx" } });
    expect((bad.structuredContent as any).valid).toBe(false);
    expect((bad.structuredContent as any).errors.map((e: { field: string }) => e.field)).toEqual(["amount", "purposeCode", "recipientIban"]);
    const charity = await client.callTool({ name: "validate_upn", arguments: { ...BILL, amount: undefined, payerName: undefined, payerAddress: undefined, payerCity: undefined, orderType: "registered_issuer" } });
    expect(charity.structuredContent).toMatchObject({ valid: true, orderType: "registered_issuer" });
  });

  it("generate_upn returns the payload, a PNG and an SVG, and the code reads back", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "generate_upn", arguments: { ...BILL, recipientIban: "SI56 9900 0001 2345 646" } });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as any;
    expect(out.payload.startsWith("UPNQR\n")).toBe(true);
    expect(out.fields).toMatchObject({ recipientIban: SI_IBAN, recipientReference: "SI120000020261047", amount: 123.45 });
    expect(out.formatted).toEqual({ amount: "***123,45", recipientIban: "SI56 9900 0001 2345 646", recipientReference: "SI12 0000020261047", dueDate: "31.10.2026" });
    expect(out.svg).toMatch(/^<svg/);
    expect(json(result)).toEqual(out);
    const image = (result.content as { type: string; data?: string; mimeType?: string }[]).find((c) => c.type === "image")!;
    expect(image).toMatchObject({ mimeType: "image/png", data: out.png });

    const read = await client.callTool({ name: "read_upn", arguments: { image: out.png, mimeType: "image/png" } });
    expect(read.structuredContent).toMatchObject({ valid: true, orderType: "payment", errors: [], payload: out.payload, fields: out.fields, qr: { version: "15", ecLevel: "M", eci: true } });
  });

  it("generate_upn refuses invalid data and says what to fix", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "generate_upn", arguments: { ...BILL, purpose: "Pizza 🍕", payerName: undefined } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^No QR code was made; fix these fields first:\n- payerName: .*\n- purpose: .*🍕/);
  });

  it("generate_upn makes a bigger PNG on request", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "generate_upn", arguments: { ...BILL, pngScale: 10 } });
    expect(Buffer.from((result.structuredContent as any).png, "base64").readUInt32BE(16)).toBe(850);
  });

  it("generate_upn_form returns the form as an embedded PDF", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "generate_upn_form", arguments: { ...BILL } });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as any;
    expect(out).toMatchObject({ orderType: "payment", paper: "a4", warnings: [], fields: { recipientIban: SI_IBAN } });
    expect(out.savedTo).toBeUndefined();
    const resource = (result.content as any[]).find((c) => c.type === "resource").resource;
    expect(resource.mimeType).toBe("application/pdf");
    const pdf = Buffer.from(resource.blob, "base64");
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBe(out.bytes);
  });

  it("generate_upn_form saves to outputPath, and never overwrites", async () => {
    const client = await connect();
    const dir = mkdtempSync(join(tmpdir(), "upn-form-"));
    try {
      const path = join(dir, "UPN-2026-104.pdf");
      const saved = await client.callTool({ name: "generate_upn_form", arguments: { ...BILL, paper: "form", outputPath: path } });
      expect(saved.structuredContent).toMatchObject({ savedTo: path, paper: "form" });
      expect((saved.content as any[]).some((c) => c.type === "resource")).toBe(false);
      const first = readFileSync(path);
      expect(first.subarray(0, 5).toString("latin1")).toBe("%PDF-");

      const again = await client.callTool({ name: "generate_upn_form", arguments: { ...BILL, amount: 1, outputPath: path } });
      expect(again.isError).toBe(true);
      expect(text(again)).toMatch(/already exists.*Nothing was overwritten/);
      expect(readFileSync(path).equals(first)).toBe(true);

      for (const bad of ["form.pdf", join(dir, "form.png"), join(dir, "missing", "form.pdf")]) {
        const refused = await client.callTool({ name: "generate_upn_form", arguments: { ...BILL, outputPath: bad } });
        expect(refused.isError, bad).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("generate_upn_form refuses invalid data and says what to fix", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "generate_upn_form", arguments: { ...BILL, recipientIban: undefined } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^No PDF was made; fix these fields first:\n- recipientIban: /);
  });

  it("read_upn reads an official example, from a JPEG photo too", async () => {
    const client = await connect();
    const png = await client.callTool({ name: "read_upn", arguments: { image: fixture("example-cover.png").toString("base64"), mimeType: "image/png" } });
    expect(png.structuredContent).toMatchObject({
      valid: true,
      orderType: "payment",
      fields: { recipientName: "Snaga d.o.o.", recipientAddress: "Povšetova ulica 6", amount: 14.71, dueDate: "2016-06-25", purposeCode: "SCVE" },
      formatted: { amount: "***14,71", recipientIban: "SI56 0510 0801 0486 080", recipientReference: "SI12 1033842574531", dueDate: "25.06.2016" },
    });
    const jpeg = await client.callTool({ name: "read_upn", arguments: { image: `data:image/jpeg;base64,${fixture("example-g-photo.jpg").toString("base64")}`, mimeType: "image/jpeg" } });
    expect(jpeg.structuredContent).toMatchObject({ valid: true, fields: { recipientName: "Gesselshaft GmbH", recipientReference: "RF45SBO2010" } });
  });

  it("read_upn reads every UPN QR code in one image", async () => {
    const client = await connect();
    const first = encodeQr(encodeUpn(BILL).bytes);
    const second = encodeQr(encodeUpn({ ...BILL, amount: 7.5, purpose: "Račun 2026-105" }).bytes);
    const size = first.size * 2 + 12;
    const modules = Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) => (y < first.size ? (x < first.size ? first.modules[y]![x]! : x >= first.size + 12 ? second.modules[y]![x - first.size - 12]! : false) : false)),
    );
    const image = Buffer.from(toPng({ size, version: 15, modules })).toString("base64");
    const result = (await client.callTool({ name: "read_upn", arguments: { image, mimeType: "image/png" } })).structuredContent as any;
    const amounts = [result.fields.amount, ...result.moreCodes.map((c: { fields: { amount: number } }) => c.fields.amount)].sort((a, b) => a - b);
    expect(amounts).toEqual([7.5, 123.45]);
  });

  it("read_upn treats a charity's order without payer or amount as a registered issuer's", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "read_upn", arguments: { image: fixture("example-d.png").toString("base64"), mimeType: "image/png" } });
    expect(result.structuredContent).toMatchObject({ valid: true, orderType: "registered_issuer", warnings: expect.arrayContaining([expect.stringMatching(/registered issuer/)]) });
  });

  it("read_upn explains what's wrong with the image", async () => {
    const client = await connect();
    const pdf = await client.callTool({ name: "read_upn", arguments: { image: "JVBERi0=", mimeType: "application/pdf" } });
    expect(text(pdf)).toMatch(/Only PNG and JPEG/);
    const notImage = await client.callTool({ name: "read_upn", arguments: { image: Buffer.from("hello").toString("base64"), mimeType: "image/png" } });
    expect(text(notImage)).toMatch(/isn't a PNG or JPEG/);
    const notBase64 = await client.callTool({ name: "read_upn", arguments: { image: "not base64!", mimeType: "image/png" } });
    expect(text(notBase64)).toMatch(/base64/);
    const blank = toPng({ size: 21, version: 1, modules: Array.from({ length: 21 }, () => Array<boolean>(21).fill(false)) });
    const none = await client.callTool({ name: "read_upn", arguments: { image: Buffer.from(blank).toString("base64"), mimeType: "image/png" } });
    expect(none.isError).toBe(true);
    expect(text(none)).toMatch(/No QR code found/);
    const other = toPng(encodeQr(encodeLatin2("https://example.com")));
    const notUpn = await client.callTool({ name: "read_upn", arguments: { image: Buffer.from(other).toString("base64"), mimeType: "image/png" } });
    expect(text(notUpn)).toMatch(/1 QR code, but no UPN QR code/);
  });

  it("read_upn reports problems in a damaged code", async () => {
    const client = await connect();
    const payload = "UPNQR\n\n\n\n\nJanez Novak\nLepa cesta 10\n2000 Maribor\n00000001471\n\n\nSCVE\nRavn. z odpadki 04/2016 0040098579\n25.06.2016\nSI56051008010486081\nSI121033842574531\nSnaga d.o.o.\nPovšetova ulica 6\n1000 Ljubljana\n199\n";
    const image = Buffer.from(toPng(encodeQr(encodeLatin2(payload)))).toString("base64");
    const result = await client.callTool({ name: "read_upn", arguments: { image, mimeType: "image/png" } });
    expect(result.structuredContent).toMatchObject({ valid: false });
    expect((result.structuredContent as any).errors.map((e: { field: string }) => e.field)).toEqual(["checksum", "recipientIban"]);
  });

  it("serves the purpose codes, reference models and fields as resources", async () => {
    const client = await connect();
    const resource = async (uri: string) => JSON.parse(((await client.readResource({ uri })).contents[0] as { text: string }).text);
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(["upn://fields", "upn://purpose-codes", "upn://reference-models"]);
    const codes = await resource("upn://purpose-codes");
    expect(codes.codes.length).toBeGreaterThan(250);
    expect(codes.codes.map((c: { code: string }) => c.code)).toEqual(expect.arrayContaining(["OTHR", "GDSV", "SUPP", "RENT", "CHAR"]));
    expect(codes.codes.find((c: { code: string }) => c.code === "GDSV")).toMatchObject({ nameSl: "Kupoprodaja blaga in storitev" });
    const models = await resource("upn://reference-models");
    expect(models.models.find((m: { model: string }) => m.model === "SI12")).toEqual({ model: "SI12", parts: { required: 1, allowed: 1 }, checkDigits: ["P1"] });
    const fields = await resource("upn://fields");
    expect(fields.fields).toHaveLength(20);
  });

  it("formats amounts like the paper form", () => {
    expect(formatAmount(1234.5)).toBe("***1.234,50");
    expect(formatAmount(0)).toBe("***0,00");
    expect(formatAmount(999999999.99)).toBe("***999.999.999,99");
  });
});
