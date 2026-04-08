const {
  loadHtml,
  htmlToText,
  cleanText,
  extractPNR,
  extractFlightNumbers,
  extractAirportCodes,
  extractDates,
  extractTimes,
  extractPassengerNames,
  extractPricing,
} = require('./helpers');
const { emptyBooking } = require('../schema/booking');

// Known airline codes → names
const AIRLINE_MAP = {
  '6E': 'IndiGo',
  AI: 'Air India',
  UK: 'Vistara',
  SG: 'SpiceJet',
  IX: 'Air India Express',
  EK: 'Emirates',
  EY: 'Etihad Airways',
  QR: 'Qatar Airways',
  SQ: 'Singapore Airlines',
  TG: 'Thai Airways',
  BA: 'British Airways',
  LH: 'Lufthansa',
  AF: 'Air France',
  AA: 'American Airlines',
  UA: 'United Airlines',
  DL: 'Delta Air Lines',
  QF: 'Qantas',
  CX: 'Cathay Pacific',
  GA: 'Garuda Indonesia',
  MH: 'Malaysia Airlines',
};

/**
 * Generic rule-based parser. Extracts booking data from any airline email
 * using common patterns (PNR, flight numbers, airport codes, dates, etc.).
 *
 * @param {string} htmlBody - Raw HTML content of the email
 * @returns {object} Parsed booking object (may be partial)
 */
function parse(htmlBody) {
  const $ = loadHtml(htmlBody);
  const text = htmlToText(htmlBody);

  const booking = emptyBooking();

  // Extract PNR
  booking.pnr = extractPNR(text);
  booking.bookingReference = booking.pnr;

  // Extract flight numbers and build flight objects
  const flightNumbers = extractFlightNumbers(text);
  const airportCodes = extractAirportCodes(text);
  const dates = extractDates(text);
  const times = extractTimes(text);

  // Try to identify the airline from the first flight number
  if (flightNumbers.length > 0) {
    const firstFlight = flightNumbers[0];
    const airlineCode = firstFlight.match(/^([A-Z0-9]{2})/)?.[1];
    if (airlineCode && AIRLINE_MAP[airlineCode]) {
      booking.airline = {
        code: airlineCode,
        name: AIRLINE_MAP[airlineCode],
      };
    }
  }

  // Build flight segments
  // Pair up airports (departure, arrival) and assign dates/times
  for (let i = 0; i < flightNumbers.length; i++) {
    const flight = {
      flightNumber: flightNumbers[i],
      departureAirport: airportCodes[i * 2] || null,
      departureCity: null,
      arrivalAirport: airportCodes[i * 2 + 1] || null,
      arrivalCity: null,
      departureDate: dates[i] || dates[0] || null,
      departureTime: times[i * 2] || null,
      arrivalDate: null,
      arrivalTime: times[i * 2 + 1] || null,
      terminal: null,
      cabin: extractCabin(text),
      status: 'confirmed',
    };

    booking.flights.push(flight);
  }

  // Extract passengers
  booking.passengers = extractPassengerNames(text);

  // Extract pricing
  booking.pricing = extractPricing(text);

  // Try to extract contact info
  booking.contact.email = extractEmail(text);
  booking.contact.phone = extractPhone(text);

  return booking;
}

/**
 * Detect cabin class from text.
 */
function extractCabin(text) {
  const cabinPatterns = [
    { pattern: /\b(?:business\s*class|class:\s*business|cabin:\s*business)\b/i, value: 'Business' },
    { pattern: /\b(?:first\s*class|class:\s*first|cabin:\s*first)\b/i, value: 'First' },
    { pattern: /\b(?:premium\s*economy|class:\s*premium\s*economy)\b/i, value: 'Premium Economy' },
    { pattern: /\b(?:economy\s*class|class:\s*economy|cabin:\s*economy)\b/i, value: 'Economy' },
  ];

  for (const { pattern, value } of cabinPatterns) {
    if (pattern.test(text)) return value;
  }

  return null;
}

function extractEmail(text) {
  const match = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0] : null;
}

function extractPhone(text) {
  const match = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  return match ? match[0] : null;
}

module.exports = { parse };
