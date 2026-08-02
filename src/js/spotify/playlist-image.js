const MAX_BYTES = 256 * 1024;
const MAX_DIMENSION = 640;

export async function preparePlaylistCover(file, {
  maxBytes = MAX_BYTES,
  maxDimension = MAX_DIMENSION,
  createImageBitmapImpl = globalThis.createImageBitmap,
  documentImpl = globalThis.document,
} = {}) {
  if (!(file instanceof Blob)) throw new TypeError("Choose an image file first.");
  if (!String(file.type || "").startsWith("image/")) throw new TypeError("Playlist covers must be image files.");
  if (typeof createImageBitmapImpl !== "function" || !documentImpl?.createElement) {
    if (file.type === "image/jpeg" && file.size <= maxBytes) return blobToBase64(file);
    throw new Error("This browser cannot resize playlist artwork.");
  }

  const bitmap = await createImageBitmapImpl(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = documentImpl.createElement("canvas");
    canvas.width = Math.min(maxDimension, side);
    canvas.height = Math.min(maxDimension, side);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Could not prepare the playlist cover.");
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const sx = Math.max(0, (bitmap.width - side) / 2);
    const sy = Math.max(0, (bitmap.height - side) / 2);
    context.drawImage(bitmap, sx, sy, side, side, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.92, 0.82, 0.72, 0.62, 0.52, 0.42]) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (blob.size <= maxBytes) return blobToBase64(blob);
    }
    throw new Error("That image could not be compressed below Spotify's 256 KB limit.");
  } finally {
    bitmap.close?.();
  }
}

export function stripDataUrlPrefix(value) {
  return String(value || "").replace(/^data:image\/jpeg;base64,/iu, "");
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode the playlist cover.")), type, quality);
  });
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export { MAX_BYTES as MAX_PLAYLIST_COVER_BYTES };
