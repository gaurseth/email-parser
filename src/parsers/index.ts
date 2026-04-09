import * as genericParser from './generic';
import * as ethiopianParser from './ethiopian';
import { htmlToText } from './helpers';
import { validateBooking } from '../schema/booking';
import * as llm from '../services/llm';
import type { Booking, Attachment, AirlineParser, ParseResult } from '../types';

const AIRLINE_PARSERS: AirlineParser[] = [
  {
    id: 'ethiopian',
    canParse: ethiopianParser.canParse,
    parse: ethiopianParser.parse,
  },
];

const BOOKING_KEYWORDS: string[] = [
  'booking confirmation',
  'e-ticket',
  'itinerary',
  'booking reference',
  'reservation',
  'pnr',
  'flight confirmation',
  'confirmed booking',
  'ticket confirmation',
  'your trip',
  'your flight',
  'boarding pass',
];

const BOOKING_PATTERNS: RegExp[] = [
  /\b[A-Z]{2}\s?\d{2,4}\b/,
  /\b(?:pnr|booking\s*ref)/i,
  /\be-?ticket\b/i,
];

export function isBookingEmail(subject: string, bodyText: string): boolean {
  const combined = `${subject} ${bodyText}`.toLowerCase();

  const hasKeyword = BOOKING_KEYWORDS.some((kw) => combined.includes(kw));
  if (hasKeyword) return true;

  const hasPattern = BOOKING_PATTERNS.some((p) => p.test(combined));
  return hasPattern;
}

export async function identifyAndParse(
  from: string,
  subject: string,
  htmlBody: string,
  attachments: Attachment[] = [],
): Promise<ParseResult> {
  const bodyText = htmlToText(htmlBody);

  // Step 1: Try airline-specific parsers first
  for (const airline of AIRLINE_PARSERS) {
    if (airline.canParse(from, subject, attachments, htmlBody)) {
      console.log(`Airline parser "${airline.id}" matched for this email`);

      const pdfAttachments = attachments.filter(
        (att) => att.contentType === 'application/pdf'
      );

      if (pdfAttachments.length === 0) {
        console.warn(`Airline parser "${airline.id}" matched but no PDF attachments found — falling through to generic`);
        continue;
      }

      for (const pdfAttachment of pdfAttachments) {
        try {
          const booking = await airline.parse(pdfAttachment.buffer);
          const { valid, confidence, errors } = validateBooking(booking);
          if (valid) {
            return {
              status: 'parsed',
              booking,
              confidence,
              parserUsed: airline.id,
              errors,
            };
          }
          console.warn(`Airline parser "${airline.id}" produced invalid result from ${pdfAttachment.filename}`);
        } catch (err) {
          console.error(`Airline parser "${airline.id}" failed on ${pdfAttachment.filename}:`, (err as Error).message);
        }
      }

      console.warn(`Airline parser "${airline.id}" could not parse any attachment — falling through to generic`);
    }
  }

  // Step 2: Check if this is a booking email
  if (!isBookingEmail(subject, bodyText)) {
    return {
      status: 'skipped',
      reason: 'Email does not appear to be a booking confirmation',
    };
  }

  // Step 3: Try rule-based generic parser
  const ruleBasedResult = genericParser.parse(htmlBody);
  const { valid, confidence, errors } = validateBooking(ruleBasedResult);

  // Step 4: If confidence is medium or high, return rule-based result
  if (valid && (confidence === 'high' || confidence === 'medium')) {
    return {
      status: 'parsed',
      booking: ruleBasedResult,
      confidence,
      parserUsed: 'generic',
      errors,
    };
  }

  // Step 5: Fall back to LLM for low confidence or invalid results
  try {
    const llmResult = await llm.parse(htmlBody, ruleBasedResult);

    const merged = mergeResults(ruleBasedResult, llmResult);
    const mergedValidation = validateBooking(merged);

    return {
      status: mergedValidation.valid ? 'parsed' : 'failed',
      booking: merged,
      confidence: mergedValidation.confidence,
      parserUsed: 'generic+llm',
      errors: mergedValidation.errors,
    };
  } catch (llmErr) {
    console.error('LLM fallback failed:', (llmErr as Error).message);

    if (valid) {
      return {
        status: 'parsed',
        booking: ruleBasedResult,
        confidence,
        parserUsed: 'generic',
        errors: [...errors, `LLM fallback failed: ${(llmErr as Error).message}`],
      };
    }

    throw new Error(`Parsing failed: ${errors.join(', ')}. LLM fallback also failed: ${(llmErr as Error).message}`);
  }
}

function mergeResults(ruleBased: Booking, llmResult: Partial<Booking>): Booking {
  const merged: Booking = { ...ruleBased };

  if (llmResult.pnr) merged.pnr = llmResult.pnr;
  if (llmResult.bookingReference) merged.bookingReference = llmResult.bookingReference;
  if (llmResult.airline?.code) merged.airline = llmResult.airline;

  if (llmResult.flights && llmResult.flights.length > 0) {
    merged.flights = llmResult.flights;
  }

  if (llmResult.passengers && llmResult.passengers.length > 0) {
    merged.passengers = llmResult.passengers;
  }

  if (llmResult.pricing) merged.pricing = llmResult.pricing;
  if (llmResult.contact?.email || llmResult.contact?.phone) {
    merged.contact = { ...merged.contact, ...llmResult.contact };
  }

  return merged;
}
