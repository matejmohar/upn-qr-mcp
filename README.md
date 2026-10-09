# UPN QR MCP

[![npm](https://img.shields.io/npm/v/upn-qr-mcp)](https://www.npmjs.com/package/upn-qr-mcp)
[![Latest release](https://img.shields.io/github/v/release/matejmohar/upn-qr-mcp)](https://github.com/matejmohar/upn-qr-mcp/releases/latest)
[![CI](https://github.com/matejmohar/upn-qr-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/matejmohar/upn-qr-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

An open-source [Model Context Protocol](https://modelcontextprotocol.io) server for Slovenian **UPN payment orders**
(univerzalni plačilni nalog) and their **UPN QR codes**.

Connect it to Claude (or any MCP-capable assistant) and let it read, check and prepare payment orders:

- *"Read these three bills and tell me what's due this week."*
- *"Create a UPN order for invoice 2026-104."*
- *"Make a printable UPN form for invoice 2026-104 and save it to my Documents."*
- *"Is this IBAN right? SI56 0200 0000 0000 068"*
- *"Make a reference for invoice 2026-104 with model SI12."*
- *"Check this payment order before I send it to the customer."*

> **It never makes a payment.** It only reads, checks and prepares payment data. You pay in your own bank or banking
> app, and you check every order there before you confirm it: the recipient, IBAN, amount and reference.

> This is an independent project. It is not made or endorsed by Združenje bank Slovenije (ZBS) or by any bank.

## Slovenščina

Strežnik prebere kodo UPN QR s fotografije ali skena položnice, preveri vsa polja po standardu ZBS in pripravi kodo
UPN QR za vaš račun, ki jo prebere vsaka slovenska mobilna banka. Razume slovenska vprašanja in odgovarja v jeziku,
v katerem pišete. Primeri:

- *»Preberi te tri položnice in povej, kaj zapade ta teden.«*
- *»Pripravi UPN za račun 2026-104.«*
- *»Naredi položnico za račun 2026-104 v PDF za tisk.«*
- *»Ali je ta IBAN pravilen?«*
- *»Naredi sklic po modelu SI12 za račun 2026-104.«*

Strežnik plačil ne izvaja: plačate sami, v svoji banki, kjer nalog pred potrditvijo preverite.

## Setup

### Quickest: Claude Desktop extension

1. Download `upn-qr-mcp-<version>.mcpb` from the [latest release](https://github.com/matejmohar/upn-qr-mcp/releases/latest).
2. Double-click it (or drag it into Claude Desktop → Settings → Extensions) and click **Install**.

There is nothing to configure: no account, no API key, no settings. To update, download the newer `.mcpb` and open it.

### Any MCP client

You need [Node.js](https://nodejs.org) 22 or newer.

**Claude Desktop** — Settings → Developer → Edit Config, and add:

```json
{
  "mcpServers": {
    "upn-qr": {
      "command": "npx",
      "args": ["-y", "upn-qr-mcp"]
    }
  }
}
```

Restart Claude Desktop; the UPN tools appear under the tools icon.

**Claude Code**

```sh
claude mcp add upn-qr -- npx -y upn-qr-mcp
```

**Cursor, VS Code and other MCP clients** — use the same command, `npx -y upn-qr-mcp`.

## What it can do

| Tool | What it does |
|---|---|
| `read_upn` | Reads the UPN QR code on a bill from a photo or scan (PNG or JPEG), splits it into fields and checks them. Several codes in one image (a page of forms) are all read. |
| `generate_upn` | Makes a UPN QR code for a payment order, as PNG and SVG (the SVG prints at the standard's 36 mm). Checks the fields first and refuses invalid data, saying what to fix. |
| `generate_upn_form` | Makes the whole printable UPN form as a PDF, filled in and with its QR code, laid out as in the ZBS standard: on an A4 page with room for a letter above (the standard's "UPN QR A4 z dopisom"), or the 210 × 99 mm form alone. Saves it to a file you name (never overwriting one) or returns it. |
| `validate_upn` | Checks a payment order's fields against the standard: required fields for the kind of order, lengths, characters, amount, dates, purpose code, IBANs, references. |
| `validate_iban` | Checks an IBAN (ISO 13616) and names the Slovenian bank. |
| `validate_reference` | Checks a payment reference: SI models SI00–SI99 with their check digits, and RF creditor references (ISO 11649). |
| `build_reference` | Adds the check digits to a reference, e.g. model SI12 for invoice 2026104 gives `SI12 0000020261047`. |

Resources: `upn://purpose-codes` (purpose codes such as OTHR, GDSV, SUPP, with Slovenian and English names, from the
ZBS list), `upn://reference-models` (the SI reference models) and `upn://fields` (the fields of a UPN QR code and which
ones each kind of order needs).

The four kinds of order the form is used for are all supported: an ordinary payment (`payment`), an order printed by
a registered issuer such as a charity (`registered_issuer`), a cash deposit (`deposit`) and a cash withdrawal
(`withdrawal`).

## Why this exists

Slovenian bills come with a UPN form, and its QR code holds everything a bank needs to pay it. That makes UPN QR a
natural bridge between an AI assistant and payments that still leaves the paying to you: the assistant can read a pile
of bills and tell you what's due, or turn an unpaid invoice into a code your customer scans with their banking app.

Getting it right takes care. The standard fixes the QR version, error correction, character set (ISO 8859-2, so that
č, š and ž survive), field lengths and a checksum, and references have check digits of their own. This server
implements the official ZBS documents, field by field, and checks itself against the examples printed in the standard.

### With Metakocka MCP

It pairs with [Metakocka MCP](https://github.com/matejmohar/metakocka-mcp), which connects Claude to the Metakocka ERP.
With both installed:

- *"Which invoices are unpaid? Make a UPN QR code for each, to send with a reminder."* — Metakocka MCP finds the unpaid
  invoices and their customers; UPN QR MCP turns each into a payment order with the right amount, IBAN and reference.
- *"Here are this month's supplier bills. Check them against our received invoices in Metakocka."* — UPN QR MCP reads
  the bills; Metakocka MCP finds the matching documents.

## How it works

- Everything runs on your computer. No account, no settings, and no network requests: images and payment data never
  leave your machine through this server.
- **What the assistant sees:** the results of the tools it calls (the fields of a bill, a generated code) go to your
  AI provider (e.g. Anthropic for Claude) as part of the conversation, like anything else you paste into a chat.
- The printable form follows the coordinates table of the ZBS technical standard. Its fonts can't be bundled, so it uses
  free look-alikes: Source Sans 3 for Myriad Pro and Liberation Mono, which has Courier New's metrics, for the filled-in
  data (both SIL Open Font License, in `fonts/`). It is a printout for the payer, not a certified form: ZBS has
  companies that issue UPN forms get them checked by its authorised company first, and printed forms belong on OCR
  paper. If you send UPN forms to your customers, check with your bank.
- QR codes are generated with [Project Nayuki's QR library](https://www.nayuki.io/page/qr-code-generator-library),
  which allows exactly the parameters the standard requires (version 15, level M, ECI 4 and one byte segment), and read
  with [ZXing-C++ compiled to WebAssembly](https://github.com/Sec-ant/zxing-wasm), which also decodes the PNG or JPEG.
  Both are plain JavaScript/WebAssembly, so the extension works on macOS, Windows and Linux without native builds.
- Dates are `YYYY-MM-DD` and amounts are in euros. Results also carry the values as printed on the paper form
  (`***1.234,50`, `SI56 0510 0801 0486 080`, `25.06.2026`) for showing to the user.

### Standards

Every rule cites its source in the code. The sources, all published by Združenje bank Slovenije at
[zbs-giz.si](https://www.zbs-giz.si/standardi-in-prirocniki/):

- *UPN QR – tehnični standard*, version 1.1, November 2016, and *Navodilo o obliki, vsebini in uporabi UPN QR*, version
  1.1, with its annexes (field structure, which fields each kind of order needs).
- *Pravila za oblikovanje in uporabo standardiziranih referenc pri opravljanju plačilnih storitev*, version 1.4,
  November 2023 (SI and RF references).
- *Šifrant kod namenov plačil* (purpose codes), 7 August 2019.
- The Bank of Slovenia's list of IBAN issuer codes, for bank names.

## Limitations

- Images only: PNG and JPEG. For a PDF bill, send a screenshot.
- The PDF form isn't a certified UPN form (see above).
- Purpose codes outside the ZBS list are accepted with a warning, since the list is from 2019.
- IBANs from countries other than Slovenia are checked for their check digits (ISO 13616), not for their country's
  exact length.

## Roadmap

- [x] Read, check and generate UPN QR codes; IBAN and reference checks
- [x] One-click Claude Desktop extension (`.mcpb`)
- [ ] PDF bills
- [x] The printable UPN form as PDF
- [ ] Country-specific IBAN lengths

What changed in each version: [releases](https://github.com/matejmohar/upn-qr-mcp/releases).

## Contributing

Development setup, project layout and how releases work: [CONTRIBUTING.md](https://github.com/matejmohar/upn-qr-mcp/blob/main/CONTRIBUTING.md).

## Need help?

Setup, payment automations around your ERP, or a version for your company: get in touch at [martej.com](https://martej.com).

## License

[MIT](LICENSE). Includes Project Nayuki's QR Code generator library (MIT), and the fonts Source Sans 3 and Liberation
Mono (SIL Open Font License 1.1, see `fonts/`).
