// AstroPilot — FITS Header Parser
// =================================
// Reads FITS headers directly from .fits/.fit/.fts files without
// loading pixel data. FITS headers are plain ASCII in 2880-byte blocks,
// so this is fast even for large files.

const fs = require('fs');

const BLOCK_SIZE = 2880;
const CARD_SIZE = 80;
const CARDS_PER_BLOCK = BLOCK_SIZE / CARD_SIZE; // 36

function parseFitsHeaders(filePath) {
   const fd = fs.openSync(filePath, 'r');
   const keywords = {};
   const buf = Buffer.alloc(BLOCK_SIZE);
   let done = false;

   try {
      while (!done) {
         const bytesRead = fs.readSync(fd, buf, 0, BLOCK_SIZE);
         if (bytesRead < BLOCK_SIZE) break;

         for (let i = 0; i < CARDS_PER_BLOCK; i++) {
            const card = buf.toString('ascii', i * CARD_SIZE, (i + 1) * CARD_SIZE);

            if (card.startsWith('END ') || card.trimEnd() === 'END') {
               done = true;
               break;
            }

            const parsed = parseCard(card);
            if (parsed) {
               keywords[parsed.key] = parsed.value;
            }
         }
      }
   } finally {
      fs.closeSync(fd);
   }

   return keywords;
}

function parseCard(card) {
   // FITS cards are 80 chars: keyword (8) + '= ' + value + ' / ' + comment
   const key = card.substring(0, 8).trimEnd();
   if (!key || key === 'COMMENT' || key === 'HISTORY') return null;

   // Check for value indicator
   if (card[8] !== '=' || card[9] !== ' ') return null;

   const valueStr = card.substring(10).split('/')[0].trimEnd();

   // String value (starts with quote)
   if (valueStr.trimStart().startsWith("'")) {
      const match = valueStr.match(/'([^']*)'/);
      return { key, value: match ? match[1].trimEnd() : '' };
   }

   // Boolean
   const trimmed = valueStr.trim();
   if (trimmed === 'T') return { key, value: true };
   if (trimmed === 'F') return { key, value: false };

   // Number
   const num = parseFloat(trimmed);
   if (!isNaN(num)) return { key, value: num };

   return { key, value: trimmed };
}

module.exports = { parseFitsHeaders };
