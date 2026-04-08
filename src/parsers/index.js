const genericParser = require('./generic');
const ethiopianParser = require('./ethiopian');
const { htmlToText } = require('./helpers');
const { validateBooking } = require('../schema/booking');
const llm = require('../services/llm');

// Airline-specific parser registry
const AIRLINE_PARSERS = [
  {
    id: 'ethiopian',
    canParse: ethiopianParser.canParse,
    parse: ethiopianParser.parse,
  },
];

// Keywords that indicate this is a booking confirmation email
const BOOKING_KEYWORDS = [
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

// Patterns that strongly suggest a booking email
const BOOKING_PATTERNS = [
  /\b[A-Z]{2}\s?\d{2,4}\b/, // Flight number (2 letters + 2-4 digits)
  /\b(?:pnr|booking\s*ref)/i,
  /\be-?ticket\b/i,
];

/**
 * Check if the email appears to be a booking confirmation.
 */
function isBookingEmail(subject, bodyText) {
  const combined = `${subject} ${bodyText}`.toLowerCase();

  // Check keywords
  const hasKeyword = BOOKING_KEYWORDS.some((kw) => combined.includes(kw));
  if (hasKeyword) return true;

  // Check patterns
  const hasPattern = BOOKING_PATTERNS.some((p) => p.test(combined));
  return hasPattern;
}

/**
 * Main entry point: identify email type and parse if it's a booking.
 *
 * @param {string} from - Sender email address
 * @param {string} subject - Email subject line
 * @param {string} htmlBody - HTML content of the email
 * @param {Array<{filename: string, contentType: string, buffer: Buffer}>} attachments - Email attachments
 * @returns {Promise<object>} Parse result with status, booking, confidence, parserUsed
 */
async function identifyAndParse(from, subject, htmlBody, attachments = []) {
  const bodyText = htmlToText(htmlBody);

  // Step 1: Try airline-specific parsers first (they may use attachments)
  for (const airline of AIRLINE_PARSERS) {
    if (airline.canParse(from, subject, attachments, htmlBody)) {
      try {
        const pdfAttachment = attachments.find(
          (att) => att.contentType === 'application/pdf'
        );
        if (pdfAttachment) {
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
        }
      } catch (err) {
        console.error(`Airline parser ${airline.id} failed:`, err.message);
        // Fall through to generic parser
      }
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
    const llmValidation = validateBooking(llmResult);

    // Merge: prefer LLM results but keep rule-based data that LLM missed
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
    console.error('LLM fallback failed:', llmErr.message);

    // If rule-based had anything, return it even with low confidence
    if (valid) {
      return {
        status: 'parsed',
        booking: ruleBasedResult,
        confidence,
        parserUsed: 'generic',
        errors: [...errors, `LLM fallback failed: ${llmErr.message}`],
      };
    }

    throw new Error(`Parsing failed: ${errors.join(', ')}. LLM fallback also failed: ${llmErr.message}`);
  }
}

/**
 * Merge rule-based and LLM results. LLM takes precedence for non-null fields.
 */
function mergeResults(ruleBased, llmResult) {
  const merged = { ...ruleBased };

  if (llmResult.pnr) merged.pnr = llmResult.pnr;
  if (llmResult.bookingReference) merged.bookingReference = llmResult.bookingReference;
  if (llmResult.airline?.code) merged.airline = llmResult.airline;

  if (llmResult.flights?.length > 0) {
    merged.flights = llmResult.flights;
  }

  if (llmResult.passengers?.length > 0) {
    merged.passengers = llmResult.passengers;
  }

  if (llmResult.pricing) merged.pricing = llmResult.pricing;
  if (llmResult.contact?.email || llmResult.contact?.phone) {
    merged.contact = { ...merged.contact, ...llmResult.contact };
  }

  return merged;
}

module.exports = { identifyAndParse, isBookingEmail };
