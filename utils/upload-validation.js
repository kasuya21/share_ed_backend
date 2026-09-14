export function isSupportedFile(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    || buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP")
    || buffer.toString("ascii", 0, 5) === "%PDF-"
    || (buffer.toString("ascii", 4, 8) === "ftyp" && ["isom", "iso2", "mp41", "mp42", "avc1", "M4V "].includes(buffer.toString("ascii", 8, 12)));
}
