import { PDFDocument } from "pdf-lib";

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** Accept only images the invoice engine can render, before any storage write. */
export async function decodeInvoiceLogo(dataUrl: string) {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("Choose a PNG or JPG image.");
  const bytes = new Uint8Array(Buffer.from(match[2]!, "base64"));
  if (!bytes.length || bytes.length > MAX_LOGO_BYTES)
    throw new Error("The logo must be 2 MB or smaller.");
  const png = match[1] === "png";
  if (png) {
    const magic = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 24 || !magic.every((v, i) => bytes[i] === v))
      throw new Error("This is not a valid PNG image.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Check dimensions before PNG decompression, not after allocating its pixels.
    if (view.getUint32(16) > 4096 || view.getUint32(20) > 4096)
      throw new Error("Resize the logo to at most 4096 pixels on each side.");
  } else if (bytes[0] !== 255 || bytes[1] !== 216)
    throw new Error("This is not a valid JPG image.");
  const pdf = await PDFDocument.create();
  let image;
  try {
    image = png ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  } catch {
    throw new Error("This image could not be read. Export it as a PNG or JPG and try again.");
  }
  if (!image.width || !image.height || image.width > 4096 || image.height > 4096)
    throw new Error("Resize the logo to at most 4096 pixels on each side.");
  return { bytes, contentType: png ? "image/png" : "image/jpeg", extension: png ? "png" : "jpg" };
}
