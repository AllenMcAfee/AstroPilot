// AstroPilot — XISF Header Parser
// ==================================
// Reads metadata from .xisf files without loading pixel data.
// XISF uses an XML header followed by binary data. The header
// starts after a 16-byte signature and its length is encoded
// in bytes 8-11 (little-endian uint32).

const fs = require('fs');

function parseXisfHeaders(filePath) {
   const fd = fs.openSync(filePath, 'r');
   const keywords = {};

   try {
      // Read the 16-byte signature block
      const sig = Buffer.alloc(16);
      fs.readSync(fd, sig, 0, 16);

      const magic = sig.toString('ascii', 0, 8);
      if (magic !== 'XISF0100') {
         throw new Error('Not a valid XISF file: ' + filePath);
      }

      // Bytes 8-11: XML header length (little-endian uint32)
      const headerLen = sig.readUInt32LE(8);

      // Read the XML header
      const xmlBuf = Buffer.alloc(headerLen);
      fs.readSync(fd, xmlBuf, 0, headerLen);
      const xml = xmlBuf.toString('utf-8');

      // Pull FITSKeyword elements: <FITSKeyword name="X" value="Y" comment="Z" />
      const kwRegex = /<FITSKeyword\s+name="([^"]+)"\s+value="([^"]*)"/g;
      let match;
      while ((match = kwRegex.exec(xml)) !== null) {
         const key = match[1];
         const raw = match[2];
         keywords[key] = coerce(raw);
      }

      // Also grab Image geometry attributes if present
      const imageMatch = xml.match(/<Image[^>]+geometry="(\d+):(\d+):(\d+)"/);
      if (imageMatch) {
         keywords._width = parseInt(imageMatch[1]);
         keywords._height = parseInt(imageMatch[2]);
         keywords._channels = parseInt(imageMatch[3]);
      }
   } finally {
      fs.closeSync(fd);
   }

   return keywords;
}

function coerce(raw) {
   if (raw === 'T') return true;
   if (raw === 'F') return false;
   const num = parseFloat(raw);
   if (!isNaN(num) && raw.trim() === String(num)) return num;
   return raw.trim();
}

module.exports = { parseXisfHeaders };
