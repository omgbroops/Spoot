function synchsafe(bytes, offset) {
  return ((bytes[offset] & 0x7f) << 21)
    | ((bytes[offset + 1] & 0x7f) << 14)
    | ((bytes[offset + 2] & 0x7f) << 7)
    | (bytes[offset + 3] & 0x7f);
}

function decodeString(bytes, encoding) {
  try {
    if (encoding === 0) return new TextDecoder("windows-1252").decode(bytes);
    if (encoding === 3) return new TextDecoder("utf-8").decode(bytes);
    if (encoding === 1) {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
      if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
      return new TextDecoder("utf-16le").decode(bytes);
    }
    if (encoding === 2) return new TextDecoder("utf-16be").decode(bytes);
  } catch {}
  return new TextDecoder("utf-8").decode(bytes);
}

function clean(value) {
  return String(value || "").replace(/\0+$/u, "").replace(/\0/gu, " ").trim();
}

function readTerminated(bytes, start, encoding) {
  if (encoding === 1 || encoding === 2) {
    let end = start;
    while (end + 1 < bytes.length) {
      if (bytes[end] === 0 && bytes[end + 1] === 0) break;
      end += 2;
    }
    return { text: clean(decodeString(bytes.subarray(start, end), encoding)), next: end + 2 };
  }
  let end = start;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  return { text: clean(decodeString(bytes.subarray(start, end), encoding)), next: end + 1 };
}

function parsePicture(data, isV22) {
  const encoding = data[0];
  let position = 1;
  let mime;
  if (isV22) {
    const format = String.fromCharCode(data[1], data[2], data[3]).toUpperCase();
    mime = format === "PNG" ? "image/png" : "image/jpeg";
    position = 4;
  } else {
    let end = position;
    while (end < data.length && data[end] !== 0) end += 1;
    mime = clean(decodeString(data.subarray(position, end), 0)) || "image/jpeg";
    position = end + 1;
  }
  position += 1;
  position = readTerminated(data, position, encoding).next;
  return { mime, bytes: data.subarray(position) };
}

export function parseId3(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const output = { title: null, artist: null, album: null, picture: null, lyrics: null };
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const major = bytes[3];
    const flags = bytes[5];
    const size = synchsafe(bytes, 6);
    let offset = 10;
    if (flags & 0x40) {
      offset += major === 4 ? synchsafe(bytes, offset) : view.getUint32(offset) + 4;
    }
    const end = Math.min(10 + size, bytes.length);
    const idLength = major === 2 ? 3 : 4;
    const headerLength = major === 2 ? 6 : 10;
    const textFrames = {
      TIT2: "title", TT2: "title", TPE1: "artist", TP1: "artist", TALB: "album", TAL: "album",
    };
    while (offset + headerLength <= end) {
      let id = "";
      for (let index = 0; index < idLength; index += 1) id += String.fromCharCode(bytes[offset + index]);
      if (!id || id.charCodeAt(0) === 0) break;
      const frameSize = major === 2
        ? (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5]
        : major === 3 ? view.getUint32(offset + 4) : synchsafe(bytes, offset + 4);
      const dataStart = offset + headerLength;
      if (frameSize <= 0 || dataStart + frameSize > end) break;
      const data = bytes.subarray(dataStart, dataStart + frameSize);
      const field = textFrames[id];
      if (field && !output[field]) output[field] = clean(decodeString(data.subarray(1), data[0]));
      else if ((id === "APIC" || id === "PIC") && !output.picture) {
        try { output.picture = parsePicture(data, id === "PIC"); } catch {}
      } else if ((id === "USLT" || id === "ULT") && !output.lyrics) {
        try {
          const encoding = data[0];
          const description = readTerminated(data, 4, encoding);
          output.lyrics = decodeString(data.subarray(description.next), encoding).replace(/\0/gu, "").replace(/\r/gu, "").trim();
        } catch {}
      }
      offset = dataStart + frameSize;
    }
  }

  if ((!output.title || !output.artist) && bytes.length >= 128) {
    const offset = bytes.length - 128;
    if (bytes[offset] === 0x54 && bytes[offset + 1] === 0x41 && bytes[offset + 2] === 0x47) {
      const decode = (start, end) => clean(decodeString(bytes.subarray(start, end), 0));
      output.title ||= decode(offset + 3, offset + 33);
      output.artist ||= decode(offset + 33, offset + 63);
      output.album ||= decode(offset + 63, offset + 93);
    }
  }
  return output;
}
