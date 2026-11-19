// Browser-side image preparation, run BEFORE upload so a phone photo (3-12 MB, 4000+ px) becomes a ~1 MB, 2000 px JPEG:
//   - HEIC/HEIF (iPhone "high efficiency" photos) are converted to JPEG,
//   - the EXIF orientation is applied to the pixels (the photo does not come out sideways),
//   - the image is re-drawn on a canvas and re-encoded, which drops ALL metadata: GPS position, device, timestamps,
//   - a ~300 px thumbnail is made from the same decoded image.
// Files are handled one at a time by the caller and every bitmap/canvas is released right after use, so a 2 GB RAM phone
// never holds more than one decoded photo.
import { IMAGE_JPEG_QUALITY, IMAGE_MAX_EDGE_PX, isHeic, THUMB_JPEG_QUALITY, THUMB_MAX_EDGE_PX } from "./attachment-rules";

export interface CompressedImage {
  blob: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

/** Scale (w, h) down so the long edge is at most `max`; never up. Pure, so it is unit-tested. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** "IMG_1234.HEIC" / "photo.png" -> "IMG_1234.jpg" / "photo.jpg" */
export function jpegName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, "");
  return `${base || "photo"}.jpg`;
}

type Drawable = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(blob: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    try {
      // The orientation is stated explicitly: older engines apply it only when asked.
      const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      /* fall through to <img>, which every browser can decode and orient */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => { img.src = ""; } };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function render(src: Drawable, edge: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = fitWithin(src.width, src.height, edge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("canvas"));
  ctx.fillStyle = "#fff"; // JPEG has no transparency: a transparent PNG would turn black
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(src.source, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        canvas.width = canvas.height = 0; // hand the pixel memory back immediately
        if (blob) resolve({ blob, width, height });
        else reject(new Error("encode"));
      },
      "image/jpeg",
      quality
    );
  });
}

async function heicToJpeg(file: File): Promise<Blob> {
  const { default: heic2any } = await import("heic2any"); // ~1 MB of WASM: loaded only when a HEIC file is chosen
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: IMAGE_JPEG_QUALITY });
  return Array.isArray(out) ? out[0] : out;
}

export async function compressImage(file: File): Promise<CompressedImage> {
  const source = isHeic(file) ? await heicToJpeg(file) : file;
  const decoded = await decode(source);
  try {
    const main = await render(decoded, IMAGE_MAX_EDGE_PX, IMAGE_JPEG_QUALITY);
    const thumb = await render(decoded, THUMB_MAX_EDGE_PX, THUMB_JPEG_QUALITY);
    return { blob: main.blob, thumb: thumb.blob, width: main.width, height: main.height };
  } finally {
    decoded.release();
  }
}
