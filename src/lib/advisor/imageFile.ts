/**
 * Browser side of chat pictures: downscale a file to a JPEG data URL before it is encrypted, so a
 * phone photo becomes ~100–300 KB instead of several MB.
 */
import { IMAGE_MAX_DATA_URL_CHARS, IMAGE_MAX_SIDE } from "./images.ts";

export async function imageFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name || "This file"} is not an image.`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Cannot read ${file.name || "this image"} (try PNG or JPEG).`);
  }
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot process images.");
  // JPEG has no transparency: put the picture on white.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= IMAGE_MAX_DATA_URL_CHARS) return url;
  }
  throw new Error(`${file.name || "This image"} is too detailed to send; try a smaller one.`);
}
