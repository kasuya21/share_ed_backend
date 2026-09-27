export function isSupportedFile(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    || buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))
    || (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP")
    || buffer.toString("ascii", 0, 5) === "%PDF-"
    || (buffer.toString("ascii", 4, 8) === "ftyp" && ["isom", "iso2", "mp41", "mp42", "avc1", "M4V "].includes(buffer.toString("ascii", 8, 12)));
}

export function isSvgFile(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;

  // SVG has no binary magic bytes. Inspect the opening portion while allowing
  // the optional BOM/XML declaration and comments that may precede <svg>.
  const opening = buffer.subarray(0, 16 * 1024).toString("utf8").replace(/^\uFEFF/, "");
  const hasSvgRoot = /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+svg(?:\s[^>]*)?>\s*)?<svg(?:\s|>)/i.test(opening);
  return hasSvgRoot && /<\/svg\s*>/i.test(buffer.toString("utf8"));
}
