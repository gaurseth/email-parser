import * as cheerio from 'cheerio';
import type { Passenger, Pricing } from '../types';

export function loadHtml(html: string): cheerio.CheerioAPI {
  return cheerio.load(html);
}

export function htmlToText(html: string): string {
  const $ = loadHtml(html);
  return cleanText($('body').text() || $.text());
}

export function cleanText(str: string | null | undefined): string {
  if (!str) return '';
  return str.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}

export function extractByPattern(text: string, regex: RegExp): string | null {
  const match = text.match(regex);
  return match ? (match[1] || match[0]) : null;
}

export function extractAllByPattern(text: string, regex: RegExp): string[] {
  const results: string[] = [];
  const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  let match: RegExpExecArray | null;
  while ((match = globalRegex.exec(text)) !== null) {
    results.push(match[1] || match[0]);
  }
  return results;
}

export function extractPNR(text: string): string | null {
  const labelPatterns: RegExp[] = [
    /(?:pnr|booking\s*(?:ref|reference|code|id|number)|confirmation\s*(?:code|number|id)|record\s*locator|reservation\s*(?:code|id|number))\s*[:\-#]?\s*([A-Z0-9]{6})\b/i,
  ];

  for (const pattern of labelPatterns) {
    const result = extractByPattern(text, pattern);
    if (result && hasLetterAndDigit(result)) {
      return result.toUpperCase();
    }
  }

  const candidates = extractAllByPattern(text, /\b([A-Z0-9]{6})\b/gi);
  for (const candidate of candidates) {
    if (hasLetterAndDigit(candidate)) {
      return candidate.toUpperCase();
    }
  }

  return null;
}

function hasLetterAndDigit(str: string): boolean {
  return /[A-Z]/i.test(str) && /\d/.test(str);
}

export function extractFlightNumbers(text: string): string[] {
  const pattern = /\b([A-Z0-9]{2})\s?(\d{1,4})\b/g;
  const results: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const code = match[1].toUpperCase();
    const num = match[2];
    if (/^\d{2}$/.test(code)) continue;
    const flightNum = `${code}${num}`;
    if (!seen.has(flightNum)) {
      seen.add(flightNum);
      results.push(flightNum);
    }
  }

  return results;
}

export function extractAirportCodes(text: string): string[] {
  const codes: string[] = [];
  let match: RegExpExecArray | null;

  const bracketPattern = /\(([A-Z]{3})\)/g;
  while ((match = bracketPattern.exec(text)) !== null) {
    const code = match[1].toUpperCase();
    if (isLikelyAirportCode(code)) {
      codes.push(code);
    }
  }

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

const NON_AIRPORT_WORDS = new Set([
  'THE', 'AND', 'FOR', 'ARE', 'NOT', 'YOU', 'ALL', 'CAN', 'HAS', 'HER',
  'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'HAD', 'HIM', 'HIS', 'HOW', 'MAN',
  'NEW', 'NOW', 'OLD', 'SEE', 'WAY', 'WHO', 'BOY', 'DID', 'GET', 'LET',
  'SAY', 'SHE', 'TOO', 'USE', 'MRS', 'REF', 'TAX', 'FEE', 'NET', 'SUN',
  'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'JAN', 'FEB', 'MAR', 'APR',
  'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'GMT', 'UTC',
  'IST', 'PST', 'EST', 'CST', 'PDF', 'INR', 'USD', 'EUR', 'GBP', 'AED',
]);

function isLikelyAirportCode(code: string): boolean {
  return !NON_AIRPORT_WORDS.has(code);
}

export function parseDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;

  const cleaned = cleanText(dateStr);

  const isoMatch = cleaned.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];

  const dmy = cleaned.match(/(\d{1,2})\s*[-\/]?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s*[-\/,]?\s*(\d{4})/i);
  if (dmy) {
    const month = monthToNum(dmy[2]);
    return `${dmy[3]}-${pad(month)}-${pad(parseInt(dmy[1]))}`;
  }

  const mdy = cleaned.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2})\s*,?\s*(\d{4})/i);
  if (mdy) {
    const month = monthToNum(mdy[1]);
    return `${mdy[3]}-${pad(month)}-${pad(parseInt(mdy[2]))}`;
  }

  const slashed = cleaned.match(/(\d{2})[-\/](\d{2})[-\/](\d{4})/);
  if (slashed) {
    return `${slashed[3]}-${slashed[2]}-${slashed[1]}`;
  }

  return null;
}

export function parseTime(timeStr: string | null | undefined): string | null {
  if (!timeStr) return null;

  const cleaned = cleanText(timeStr);

  const h12 = cleaned.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (h12) {
    let hours = parseInt(h12[1]);
    if (h12[3].toUpperCase() === 'PM' && hours !== 12) hours += 12;
    if (h12[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
    return `${pad(hours)}:${h12[2]}`;
  }

  const h24 = cleaned.match(/(\d{1,2}):(\d{2})(?:\s*hrs?)?/i);
  if (h24) {
    return `${pad(parseInt(h24[1]))}:${h24[2]}`;
  }

  return null;
}

function monthToNum(month: string): number {
  const months: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  return months[month.toLowerCase().slice(0, 3)] || 0;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function extractDates(text: string): string[] {
  const datePatterns: RegExp[] = [
    /\d{4}-\d{2}-\d{2}/g,
    /\d{1,2}\s*[-\/]?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s*[-\/,]?\s*\d{4}/gi,
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}\s*,?\s*\d{4}/gi,
    /\d{2}[-\/]\d{2}[-\/]\d{4}/g,
  ];

  const dates: string[] = [];
  for (const pattern of datePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const parsed = parseDate(match[0]);
      if (parsed) dates.push(parsed);
    }
  }

  return [...new Set(dates)];
}

export function extractTimes(text: string): string[] {
  const timePatterns: RegExp[] = [
    /\d{1,2}:\d{2}\s*(?:AM|PM)/gi,
    /\d{1,2}:\d{2}(?:\s*hrs?)?/gi,
  ];

  const times: string[] = [];
  for (const pattern of timePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const parsed = parseTime(match[0]);
      if (parsed) times.push(parsed);
    }
  }

  return [...new Set(times)];
}

export function extractPassengerNames(text: string): Pick<Passenger, 'title' | 'firstName' | 'lastName'>[] {
  const labelPatterns: RegExp[] = [
    /(?:passenger|traveller|traveler|pax)\s*(?:name)?\s*[:\-]\s*(.+?)(?=\s{2,}|\n|$)/gi,
    /(?:name)\s*[:\-]\s*(.+?)(?=\s{2,}|\n|$)/gi,
  ];

  const passengers: Pick<Passenger, 'title' | 'firstName' | 'lastName'>[] = [];
  const seen = new Set<string>();

  for (const pattern of labelPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = cleanText(match[1]);
      const nameMatch = raw.match(/^(MR|MRS|MS|MISS|DR|MSTR)\.?\s+([A-Z][A-Z\s]+)/i);
      if (nameMatch) {
        const title = nameMatch[1].toUpperCase();
        const nameWords = nameMatch[2].split(/\s+/).filter((w: string) => /^[A-Z]+$/.test(w));
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

export function extractPricing(text: string): Pricing | null {
  const patterns: RegExp[] = [
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
          total: parseFloat((match[2] || match[1]).replace(/,/g, '')) || null,
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
