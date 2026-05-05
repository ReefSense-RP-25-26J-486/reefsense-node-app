function readAscii(buffer, offset, length) {
  if (offset < 0 || offset + length > buffer.length) return null;
  return buffer.toString('ascii', offset, offset + length).replace(/\0+$/, '');
}

function makeReader(buffer, littleEndian) {
  return {
    uint16(offset) {
      if (offset < 0 || offset + 2 > buffer.length) return null;
      return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
    },
    uint32(offset) {
      if (offset < 0 || offset + 4 > buffer.length) return null;
      return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
    },
  };
}

function typeSize(type) {
  switch (type) {
    case 1:
    case 2:
    case 7:
      return 1;
    case 3:
      return 2;
    case 4:
    case 9:
      return 4;
    case 5:
    case 10:
      return 8;
    default:
      return 0;
  }
}

function readIfd(buffer, tiffStart, ifdOffset, reader) {
  const entries = new Map();
  const entryCountOffset = tiffStart + ifdOffset;
  const entryCount = reader.uint16(entryCountOffset);

  if (entryCount === null) return entries;

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = entryCountOffset + 2 + index * 12;
    if (entryOffset + 12 > buffer.length) break;

    const tag = reader.uint16(entryOffset);
    const type = reader.uint16(entryOffset + 2);
    const count = reader.uint32(entryOffset + 4);
    const bytes = typeSize(type) * count;

    if (tag === null || type === null || count === null || bytes <= 0) continue;

    const valueOffset = bytes <= 4
      ? entryOffset + 8
      : tiffStart + reader.uint32(entryOffset + 8);

    if (valueOffset < 0 || valueOffset + bytes > buffer.length) continue;

    entries.set(tag, { type, count, offset: valueOffset });
  }

  return entries;
}

function readRational(buffer, offset, reader) {
  const numerator = reader.uint32(offset);
  const denominator = reader.uint32(offset + 4);

  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function readGpsCoordinate(buffer, entry, reader) {
  if (!entry || entry.type !== 5 || entry.count < 3) return null;

  const degrees = readRational(buffer, entry.offset, reader);
  const minutes = readRational(buffer, entry.offset + 8, reader);
  const seconds = readRational(buffer, entry.offset + 16, reader);

  if (degrees === null || minutes === null || seconds === null) return null;
  return degrees + minutes / 60 + seconds / 3600;
}

function parseExifGps(buffer, exifStart, exifLength) {
  if (readAscii(buffer, exifStart, 6) !== 'Exif') return null;

  const tiffStart = exifStart + 6;
  if (tiffStart + 8 > exifStart + exifLength) return null;

  const byteOrder = readAscii(buffer, tiffStart, 2);
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') return null;

  const reader = makeReader(buffer, littleEndian);
  if (reader.uint16(tiffStart + 2) !== 42) return null;

  const firstIfdOffset = reader.uint32(tiffStart + 4);
  if (firstIfdOffset === null) return null;

  const ifd0 = readIfd(buffer, tiffStart, firstIfdOffset, reader);
  const gpsPointer = ifd0.get(0x8825);
  if (!gpsPointer || gpsPointer.type !== 4 || gpsPointer.count < 1) return null;

  const gpsIfdOffset = reader.uint32(gpsPointer.offset);
  if (gpsIfdOffset === null) return null;

  const gpsIfd = readIfd(buffer, tiffStart, gpsIfdOffset, reader);
  const latitude = readGpsCoordinate(buffer, gpsIfd.get(0x0002), reader);
  const longitude = readGpsCoordinate(buffer, gpsIfd.get(0x0004), reader);
  const latitudeRef = readAscii(buffer, gpsIfd.get(0x0001)?.offset ?? -1, 2);
  const longitudeRef = readAscii(buffer, gpsIfd.get(0x0003)?.offset ?? -1, 2);

  if (latitude === null || longitude === null || !latitudeRef || !longitudeRef) return null;

  return {
    image_latitude: latitudeRef.startsWith('S') ? -latitude : latitude,
    image_longitude: longitudeRef.startsWith('W') ? -longitude : longitude,
  };
}

function extractImageLocation(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return { image_latitude: null, image_longitude: null };
  }

  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return { image_latitude: null, image_longitude: null };
  }

  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) break;

    const marker = buffer[offset + 1];
    const segmentLength = buffer.readUInt16BE(offset + 2);
    const segmentStart = offset + 4;
    const segmentEnd = offset + 2 + segmentLength;

    if (segmentLength < 2 || segmentEnd > buffer.length) break;
    if (marker === 0xe1) {
      const gps = parseExifGps(buffer, segmentStart, segmentLength - 2);
      if (gps) return gps;
    }

    offset = segmentEnd;
  }

  return { image_latitude: null, image_longitude: null };
}

module.exports = { extractImageLocation };
