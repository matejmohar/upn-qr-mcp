/**
 * QR code generation (PNG and SVG) and reading, with the parameters the UPN QR standard fixes.
 *
 * UPN QR – tehnični standard, verzija 1.1, 5.1 "Značilnosti natisnjene kode QR na obrazcu UPN QR":
 *   a. version 15 (77 × 77 modules), mandatory whatever the amount of data;
 *   b. byte (binary) data;
 *   c. error correction level M;
 *   d. character set ISO 8859-2 with Extended Channel Interpretation, ECI value 000004;
 *   e. module size 0,42333 mm; f. code 32,59676 mm without the quiet zone; g. 35,98333 mm with it.
 *
 * Generation uses Project Nayuki's QR library (vendored), which lets us fix every one of these. Reading uses
 * ZXing-C++ compiled to WebAssembly (zxing-wasm), which also decodes the PNG or JPEG itself. Both are plain
 * JS/WASM: no native builds, no network. The .wasm file is loaded from node_modules, never from a CDN.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import qrcodegen from "./vendor/qrcodegen.js";

const { QrCode, QrSegment } = qrcodegen;

/** 5.1 a. */
export const UPN_QR_VERSION = 15;
/** 5.1 d. */
export const UPN_QR_ECI = 4;
/** 5.1 e–g: the quiet zone is (35,98333 − 32,59676) / 2 mm = 1,693 mm = 4 modules of 0,42333 mm. */
export const QUIET_ZONE_MODULES = 4;
/** 5.1 g, the printed size including the quiet zone. */
export const PRINTED_SIZE_MM = 35.98333;

export class QrError extends Error {}

/** The symbol as a grid of dark (true) and light modules, without the quiet zone. */
export interface QrMatrix {
  size: number;
  version: number;
  modules: boolean[][];
}

/** Encodes ISO 8859-2 bytes as a UPN QR symbol: ECI 4, one byte segment, version 15, level M. */
export function encodeQr(bytes: Uint8Array): QrMatrix {
  const segments = [QrSegment.makeEci(UPN_QR_ECI), QrSegment.makeBytes(Array.from(bytes))];
  let qr: InstanceType<typeof QrCode>;
  try {
    // minVersion = maxVersion = 15; mask -1 = chosen automatically; boostEcl = false keeps level M.
    qr = QrCode.encodeSegments(segments, QrCode.Ecc.MEDIUM, UPN_QR_VERSION, UPN_QR_VERSION, -1, false);
  } catch (error) {
    throw new QrError(`The data doesn't fit in a version ${UPN_QR_VERSION} QR code at level M (${bytes.length} bytes): ${(error as Error).message}`);
  }
  const modules = Array.from({ length: qr.size }, (_, y) => Array.from({ length: qr.size }, (_, x) => qr.getModule(x, y)));
  return { size: qr.size, version: qr.version, modules };
}

/**
 * An SVG of the symbol with its 4-module quiet zone, sized to print at the standard's 35,98 mm (5.1 g).
 * Dark modules are one path of horizontal runs, so it stays small.
 */
export function toSvg(matrix: QrMatrix): string {
  const q = QUIET_ZONE_MODULES;
  const full = matrix.size + 2 * q;
  let path = "";
  matrix.modules.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (!row[x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end]) end++;
      path += `M${x + q} ${y + q}h${end - x}v1h-${end - x}z`;
      x = end;
    }
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PRINTED_SIZE_MM}mm" height="${PRINTED_SIZE_MM}mm" ` +
    `viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges">` +
    `<rect width="${full}" height="${full}" fill="#fff"/><path fill="#000" d="${path}"/></svg>`
  );
}

/** A black-and-white PNG (1 bit per pixel) of the symbol with its quiet zone, `scale` pixels per module. */
export function toPng(matrix: QrMatrix, scale = 4): Uint8Array {
  if (!Number.isInteger(scale) || scale < 1 || scale > 40) throw new QrError("The PNG scale is a whole number of pixels per module, 1 to 40.");
  const q = QUIET_ZONE_MODULES;
  const width = (matrix.size + 2 * q) * scale;
  const rowBytes = Math.ceil(width / 8);
  const raw = Buffer.alloc((rowBytes + 1) * width, 0);
  for (let py = 0; py < width; py++) {
    const offset = py * (rowBytes + 1); // first byte of each row: filter type 0
    const my = Math.floor(py / scale) - q;
    for (let px = 0; px < width; px++) {
      const mx = Math.floor(px / scale) - q;
      const dark = my >= 0 && my < matrix.size && mx >= 0 && mx < matrix.size && matrix.modules[my]![mx]!;
      // Grayscale, bit depth 1: 1 is white.
      if (!dark) raw[offset + 1 + (px >> 3)]! |= 0x80 >> (px & 7);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(width, 4);
  header.set([1, 0, 0, 0, 0], 8); // bit depth 1, colour type 0 (grayscale), deflate, no filter method, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ImageType = "image/png" | "image/jpeg";
export const IMAGE_TYPES: readonly ImageType[] = ["image/png", "image/jpeg"];

/** The image type from the file's first bytes, whatever its name or declared type says. */
export function sniffImageType(bytes: Uint8Array): ImageType | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return undefined;
}

export interface ScannedCode {
  /** The raw bytes of the code's content. */
  bytes: Uint8Array;
  /** The content as ZXing decoded it, honouring the code's ECI when it has one. */
  text: string;
  hasEci: boolean;
  /** QR version, e.g. "15". */
  version: string;
  /** Error correction level, e.g. "M". */
  ecLevel: string;
}

let zxingReady = false;

/** Points zxing-wasm at the .wasm file in node_modules. By default it would download it from a CDN. */
function prepareReader(): void {
  if (zxingReady) return;
  const require = createRequire(import.meta.url);
  const wasm = readFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm"));
  prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer } });
  zxingReady = true;
}

/** All QR codes in a PNG or JPEG image. */
export async function scanImage(image: Uint8Array): Promise<ScannedCode[]> {
  prepareReader();
  const results = await readBarcodes(image, {
    formats: ["QRCode"],
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: 16,
  });
  return results
    .filter((r) => r.isValid)
    .map((r) => ({ bytes: r.bytes, text: r.text, hasEci: r.hasECI, version: r.version, ecLevel: r.ecLevel }));
}
