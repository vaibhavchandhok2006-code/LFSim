// Decode a track image in Node. PNG only for now: the browser and pngjs decode PNG to the same pixels, so the command
// line builds the same track as the website. (JPEG decoders differ between browsers and libraries.)
import { PNG } from 'pngjs';

export interface Decoded { rgba: Uint8ClampedArray; width: number; height: number }

const MAX_PIXELS = 50e6;

export function decodeImage(bytes: Buffer, name = 'image'): Decoded {
  const isPng = bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) throw new Error(`${name}: only PNG track images are supported on the command line (convert JPEG/WebP to PNG first).`);
  const png = PNG.sync.read(bytes);
  if (png.width * png.height > MAX_PIXELS) throw new Error(`${name}: image too large (${png.width} × ${png.height}).`);
  // Composite over white, as the website draws the image on a white canvas.
  const d = png.data, out = new Uint8ClampedArray(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255) { out[i] = d[i]; out[i + 1] = d[i + 1]; out[i + 2] = d[i + 2]; }
    else { for (let c = 0; c < 3; c += 1) out[i + c] = Math.round((d[i + c] * a + 255 * (255 - a)) / 255); }
    out[i + 3] = 255;
  }
  return { rgba: out, width: png.width, height: png.height };
}

export function decodeDataUrl(url: string, name = 'embedded image'): Decoded {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!m) throw new Error(`${name}: not an image data URL.`);
  return decodeImage(Buffer.from(m[2], 'base64'), name);
}
