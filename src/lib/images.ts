/**
 * Turning a picked File into something uploadable.
 *
 * Everything used to be squeezed to a thumbnail on the way in — the order page
 * capped product photos at 900px, so a 1500×1500 shot uploaded by staff came
 * back to the client as 900×900 and there was no way to get the original size
 * back. A reference thumbnail and a photo the client downloads are not the same
 * thing, so the cap is now the caller's to choose.
 */
export async function compressImage(file: File, max = 900, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let w = img.width, h = img.height;
        // Only ever scale DOWN. An image already within the cap is re-encoded at
        // its own size, never stretched.
        if (w > max || h > max) {
          if (w > h) { h = Math.round(h * max / w); w = max; }
          else { w = Math.round(w * max / h); h = max; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** A photo the CLIENT downloads is kept at full size up to 2400px. Only a
 *  camera-sized original is scaled at all. */
export const PRODUCT_PHOTO_MAX = 2400;
export const PRODUCT_PHOTO_QUALITY = 0.92;

/** Above this, even a product photo is worth shrinking before it is uploaded. */
const KEEP_ORIGINAL_UNDER_MB = 12;

/**
 * Is this file fine to upload exactly as it is?
 *
 * Re-encoding keeps the pixel count but is still a second JPEG pass over an
 * image that was already fine. For the photos a client downloads the honest
 * answer is to send the file that was picked, so what comes back is what went
 * in — right down to the bytes. Only something camera-sized is worth touching.
 */
export function canUploadOriginal(file: File): boolean {
  if (!file.type.startsWith("image/")) return false;
  // A format the browser may not re-encode faithfully is also better untouched.
  return file.size <= KEEP_ORIGINAL_UNDER_MB * 1024 * 1024;
}

/** A profile photo: the middle square of the picture, small enough to sit on
 *  the person's own record (it travels with every screen's list of people). */
export const AVATAR_PX = 128;
export async function avatarFromFile(file: File): Promise<string> {
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => resolve(e.target?.result as string);
    reader.readAsDataURL(file);
  });
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = AVATAR_PX;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, AVATAR_PX, AVATAR_PX);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.src = src;
  });
}
