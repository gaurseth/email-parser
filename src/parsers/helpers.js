const cheerio = require('cheerio');

/**
 * Load HTML into cheerio.
 */
function loadHtml(html) {
  return cheerio.load(html);
}

/**
 * Extract text from HTML, collapsing whitespace.
 */
function htmlToText(html) {
  const $ = loadHtml(html);
  return cleanText($('body').text() || $.text());
}

/**
 * Clean text: trim, collapse whitespace, strip invisible chars.
 */
function cleanText(str) {
  if (!str) return '';
  return str.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Safe regex extraction. Returns the first capture group or null.
 */
function extractByPattern(text, regex) {
  const match = text.match(regex);
  return match ? (match[1] || match[0]) : null;
}

/**
 * Extract all matches for a regex (first capture group of each).
 */
function extractAllByPattern(text, regex) {
  const results = [];
  const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  let match;
  while ((match = globalRegex.exec(text)) !== null) {
    results.push(match[1] || match[0]);
  }
  return results;
}

/**
 * Extract a 6-character alphanumeric PNR/booking reference.
 * Common patterns: standalone 6-char alphanumeric (at least one letter and one digit).
 */
function extractPNR(text) {
  // Look for PNR near common labels first
  const labelPatterns = [
    /(?:pnr|booking\s*(?:ref|reference|code|id|number)|confirmation\s*(?:code|number|id)|record\s*locator|reservation\s*(?:code|id|number))\s*[:\-#]?\s*([A-Z0-9]{6})\b/i,
  ];

  for (const pattern of labelPatterns) {
    const result = extractByPattern(text, pattern);
    if (result && hasLetterAndDigit(result)) {
      return result.toUpperCase();
    }
  }

  // Fallback: find standalone 6-char codes that look like PNRs
  const candidates = extractAllByPattern(text, /\b([A-Z0-9]{6})\b/gi);
  for (const candidate of candidates) {
    if (hasLetterAndDigit(candidate)) {
      return candidate.toUpperCase();
    }
  }

  return null;
}

function hasLetterAndDigit(str) {
  return /[A-Z]/i.test(str) && /\d/.test(str);
}

/**
 * Extract flight numbers (e.g., "6E 2341", "EK524", "AI 101").
 */
function extractFlightNumbers(text) {
  const pattern = /\b([A-Z0-9]{2})\s?(\d{1,4})\b/g;
  const results = [];
  const seen = new Set();
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const code = match[1].toUpperCase();
    const num = match[2];
    // Filter out unlikely airline codes (pure numbers, common abbreviations)
    if (/^\d{2}$/.test(code)) continue;
    const flightNum = `${code}${num}`;
    if (!seen.has(flightNum)) {
      seen.add(flightNum);
      results.push(flightNum);
    }
  }

  return results;
}

/**
 * Extract 3-letter IATA airport codes.
 */
function extractAirportCodes(text) {
  const codes = [];
  let match;

  // Priority 1: "City (CODE)" or standalone "(CODE)" patterns — preserve order and duplicates
  const bracketPattern = /\(([A-Z]{3})\)/g;
  while ((match = bracketPattern.exec(text)) !== null) {
    const code = match[1].toUpperCase();
    if (isLikelyAirportCode(code)) {
      codes.push(code);
    }
  }

  // Priority 2: Near departure/arrival keywords
  if (codes.length === 0) {
    const contextPattern = /\b(?:departure|from|origin|arrival|to|destination)\b\s*[:\-]?\s*([A-Z]{3})\b/gi;
    while ((match = contextPattern.exec(text)) !== null) {
      const code = match[1].toUpperCase();
      if (isLikelyAirportCode(code)) {
        codes.push(code);
      }
    }
  }

  return codes;
}

// Common words that look like airport codes but aren't
const NON_AIRPORT_WORDS = new Set([
  'THE', 'AND', 'FOR', 'ARE', 'NOT', 'YOU', 'ALL', 'CAN', 'HAS', 'HER',
  'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'HAD', 'HIM', 'HIS', 'HOW', 'MAN',
  'NEW', 'NOW', 'OLD', 'SEE', 'WAY', 'WHO', 'BOY', 'DID', 'GET', 'LET',
  'SAY', 'SHE', 'TOO', 'USE', 'MRS', 'REF', 'TAX', 'FEE', 'NET', 'SUN',
  'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'JAN', 'FEB', 'MAR', 'APR',
  'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'GMT', 'UTC',
  'IST', 'PST', 'EST', 'CST', 'PDF', 'INR', 'USD', 'EUR', 'GBP', 'AED',
]);

function isLikelyAirportCode(code) {
  return !NON_AIRPORT_WORDS.has(code);
}

/**
 * Parse various date formats into ISO date string (YYYY-MM-DD).
 */
function parseDate(dateStr) {
  if (!dateStr) return null;

  const cleaned = cleanText(dateStr);

  // Try ISO format first
  const isoMatch = cleaned.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];

  // DD Mon YYYY or DD-Mon-YYYY
  const dmy = cleaned.match(/(\d{1,2})\s*[-\/]?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s*[-\/,]?\s*(\d{4})/i);
  if (dmy) {
    const month = monthToNum(dmy[2]);
    return `${dmy[3]}-${pad(month)}-${pad(parseInt(dmy[1]))}`;
  }

  // Mon DD, YYYY
  const mdy = cleaned.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2})\s*,?\s*(\d{4})/i);
  if (mdy) {
    const month = monthToNum(mdy[1]);
    return `${mdy[3]}-${pad(month)}-${pad(parseInt(mdy[2]))}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const slashed = cleaned.match(/(\d{2})[-\/](\d{2})[-\/](\d{4})/);
  if (slashed) {
    return `${slashed[3]}-${slashed[2]}-${slashed[1]}`;
  }

  return null;
}

/**
 * Extract time in HH:MM format.
 */
function parseTime(timeStr) {
  if (!timeStr) return null;

  const cleaned = cleanText(timeStr);

  // 12-hour format with AM/PM (check first, before 24-hour)
  const h12 = cleaned.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (h12) {
    let hours = parseInt(h12[1]);
    if (h12[3].toUpperCase() === 'PM' && hours !== 12) hours += 12;
    if (h12[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
    return `${pad(hours)}:${h12[2]}`;
  }

  // 24-hour format
  const h24 = cleaned.match(/(\d{1,2}):(\d{2})(?:\s*hrs?)?/i);
  if (h24) {
    return `${pad(parseInt(h24[1]))}:${h24[2]}`;
  }

  return null;
}

function monthToNum(month) {
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  return months[month.toLowerCase().slice(0, 3)] || 0;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Extract dates from a block of text.
 */
function extractDates(text) {
  const datePatterns = [
    /\d{4}-\d{2}-\d{2}/g,
    /\d{1,2}\s*[-\/]?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s*[-\/,]?\s*\d{4}/gi,
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}\s*,?\s*\d{4}/gi,
    /\d{2}[-\/]\d{2}[-\/]\d{4}/g,
  ];

  const dates = [];
  for (const pattern of datePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const parsed = parseDate(match[0]);
      if (parsed) dates.push(parsed);
    }
  }

  return [...new Set(dates)];
}

/**
 * Extract times from a block of text.
 */
function extractTimes(text) {
  const timePatterns = [
    /\d{1,2}:\d{2}\s*(?:AM|PM)/gi,
    /\d{1,2}:\d{2}(?:\s*hrs?)?/gi,
  ];

  const times = [];
  for (const pattern of timePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const parsed = parseTime(match[0]);
      if (parsed) times.push(parsed);
    }
  }

  return [...new Set(times)];
}

/**
 * Extract passenger names. Looks for patterns near "passenger" or "traveller" labels.
 */
function extractPassengerNames(text) {
  // Match label + everything after colon until end of line or next label
  const labelPatterns = [
    /(?:passenger|traveller|traveler|pax)\s*(?:name)?\s*[:\-]\s*(.+?)(?=\s{2,}|\n|$)/gi,
    /(?:name)\s*[:\-]\s*(.+?)(?=\s{2,}|\n|$)/gi,
  ];

  const passengers = [];
  const seen = new Set();

  for (const pattern of labelPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const raw = cleanText(match[1]);
      // Try to extract title + name from the captured text
      const nameMatch = raw.match(/^(MR|MRS|MS|MISS|DR|MSTR)\.?\s+([A-Z][A-Z\s]+)/i);
      if (nameMatch) {
        const title = nameMatch[1].toUpperCase();
        // Only take consecutive uppercase words as the name
        const nameWords = nameMatch[2].split(/\s+/).filter(w => /^[A-Z]+$/.test(w));
        if (nameWords.length >= 1) {
          const fullName = nameWords.join(' ');
          const key = `${title}:${fullName}`;
          if (!seen.has(key)) {
            seen.add(key);
            passengers.push({
              title,
              firstName: nameWords[0] || null,
              lastName: nameWords.slice(1).join(' ') || null,
            });
          }
        }
      }
    }
  }

  return passengers;
}

/**
 * Extract currency and amount.
 */
function extractPricing(text) {
  const patterns = [
    /(?:total|amount|fare|price)\s*[:\-]?\s*(INR|USD|EUR|GBP|AED|SGD|CAD|AUD)\s*\.?\s*([\d,]+\.?\d*)/gi,
    /(?:total|amount|fare|price)\s*[:\-]?\s*(?:Rs\.?|₹)\s*([\d,]+\.?\d*)/gi,
    /(INR|USD|EUR|GBP|AED|SGD|CAD|AUD)\s*([\d,]+\.?\d*)/gi,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      if (match[1] === 'Rs' || match[1] === 'Rs.' || match[1] === '₹' || !match[2]) {
        return {
          currency: 'INR',
          total: parseFloat((match[1].replace ? match[2] || match[1] : match[1]).replace(/,/g, '')) || null,
        };
      }
      return {
        currency: match[1].toUpperCase(),
        total: parseFloat(match[2].replace(/,/g, '')) || null,
      };
    }
  }

  return null;
}

module.exports = {
  loadHtml,
  htmlToText,
  cleanText,
  extractByPattern,
  extractAllByPattern,
  extractPNR,
  extractFlightNumbers,
  extractAirportCodes,
  extractDates,
  extractTimes,
  extractPassengerNames,
  extractPricing,
  parseDate,
  parseTime,
};
