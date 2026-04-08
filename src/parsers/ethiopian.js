const { PDFParse } = require('pdf-parse');
const { cleanText, parseDate, parseTime } = require('./helpers');
const { emptyBooking, emptyFlightSegment, emptyPassenger } = require('../schema/booking');

/**
 * Parse an Ethiopian Airlines booking confirmation PDF.
 *
 * @param {Buffer} pdfBuffer - Raw PDF file contents
 * @returns {Promise<object>} Parsed booking object
 */
async function parse(pdfBuffer) {
  const pdf = new PDFParse({ data: pdfBuffer });
  await pdf.load();
  const result = await pdf.getText();
  const text = result.text;

  const booking = emptyBooking();
  booking.airline = { code: 'ET', name: 'Ethiopian Airlines' };

  // Extract reservation code (PNR)
  const pnrMatch = text.match(/RESERVATION\s+CODE\s+([A-Z0-9]{5,6})/i);
  if (pnrMatch) {
    booking.pnr = pnrMatch[1].toUpperCase();
    booking.bookingReference = booking.pnr;
  }

  // Extract trip description
  const tripMatch = text.match(/TRIP\s+TO\s+(.+)/i);
  if (tripMatch) {
    booking.tripDescription = cleanText(tripMatch[1]);
  }

  // Extract flight segments
  booking.flights = extractFlightSegments(text);

  // Extract passengers from the repeated passenger rows
  booking.passengers = extractPassengers(text);

  return booking;
}

/**
 * Extract all flight segments from the PDF text.
 * Each segment starts with a "DEPARTURE:" header line and contains
 * the ETHIOPIAN AIRLINES / ET XXXX flight block.
 */
function extractFlightSegments(text) {
  const segments = [];

  // Find all DEPARTURE header positions — each one starts a segment block
  const depPattern = /DEPARTURE:\s*\w+\s+(\d{1,2}\s+\w{3})/g;
  const depMatches = [];
  let match;
  while ((match = depPattern.exec(text)) !== null) {
    depMatches.push({ index: match.index, dateStr: match[1] });
  }

  // Extract the year from the document header (e.g., "04 FEB 2026")
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();

  for (let i = 0; i < depMatches.length; i++) {
    const startIdx = depMatches[i].index;
    const endIdx = i + 1 < depMatches.length ? depMatches[i + 1].index : text.length;
    const block = text.slice(startIdx, endIdx);

    // Extract flight number from the block
    const flightMatch = block.match(/ETHIOPIAN\s+AIRLINES\s*\n\s*ET\s+(\d{3,4})/);
    if (!flightMatch) continue;

    const flightNum = `ET${flightMatch[1]}`;
    const segment = parseSegmentBlock(block, flightNum, depMatches[i].dateStr, year);
    if (segment) {
      segments.push(segment);
    }
  }

  return segments;
}

/**
 * Parse a single flight segment block of text.
 *
 * @param {string} block - Text block for this segment
 * @param {string} flightNumber - e.g., "ET0850"
 * @param {string} depDateStr - Departure date from header, e.g., "04 FEB"
 * @param {string} year - Year string, e.g., "2026"
 */
function parseSegmentBlock(block, flightNumber, depDateStr, year) {
  const segment = emptyFlightSegment();
  segment.flightNumber = flightNumber;

  // Departure date from header
  segment.departureDate = parseDate(`${depDateStr} ${year}`);

  // Duration: 4hr(s) 35min(s)
  const durationMatch = block.match(/Duration:\s*\n?\s*(\d+)hr\(s\)\s*(\d+)min\(s\)/i);
  if (durationMatch) {
    segment.duration = `${durationMatch[1]}h ${durationMatch[2]}m`;
  }

  // Cabin: Economy / V
  const cabinMatch = block.match(/Cabin:\s*\n?\s*(\w[\w\s]*?)\s*\/\s*([A-Z])/i);
  if (cabinMatch) {
    segment.cabin = cleanText(cabinMatch[1]);
    segment.bookingClass = cabinMatch[2].toUpperCase();
  }

  // Status
  const statusMatch = block.match(/Status:\s*\n?\s*(\w+)/i);
  if (statusMatch) {
    segment.status = statusMatch[1].toLowerCase();
  }

  // Aircraft: BOEING 787-9 JET (may be on the next line)
  const aircraftMatch = block.match(/Aircraft:\s*\n?\s*(.+?)(?:\n|$)/i);
  if (aircraftMatch) {
    segment.aircraft = cleanText(aircraftMatch[1]);
  }

  // Distance: appears as a standalone number on a line after aircraft
  // Pattern in the PDF text: "BOEING 787-9 JET\n2138\nMeals:"
  const distanceMatch = block.match(/Aircraft:\s*\n?\s*.+?\n(\d{3,5})\n/i);
  if (distanceMatch) {
    segment.distance = { value: parseInt(distanceMatch[1]), unit: 'miles' };
  }

  // Meals (may be on the next line)
  const mealsMatch = block.match(/Meals:\s*\n?\s*(.+?)(?:\n|$)/i);
  if (mealsMatch) {
    segment.meals = cleanText(mealsMatch[1]);
  }

  // Extract airport codes and cities
  const airportPairs = extractAirportPair(block);
  if (airportPairs) {
    segment.departureAirport = airportPairs.departure.code;
    segment.departureCity = airportPairs.departure.city;
    segment.arrivalAirport = airportPairs.arrival.code;
    segment.arrivalCity = airportPairs.arrival.city;
  }

  // Departing At: 2:05pm (may be on the next line)
  const depTimeMatch = block.match(/Departing\s+At:\s*\n?\s*(\d{1,2}:\d{2}\s*(?:am|pm))/i);
  if (depTimeMatch) {
    segment.departureTime = parseTime(depTimeMatch[1]);
  }

  const arrTimeMatch = block.match(/Arriving\s+At:\s*\n?\s*(\d{1,2}:\d{2}\s*(?:am|pm))/i);
  if (arrTimeMatch) {
    segment.arrivalTime = parseTime(arrTimeMatch[1]);
  }

  // Arrival date — check for ARRIVAL: header or inline "(Thu, Feb 5)" pattern
  const arrDateExplicit = block.match(/ARRIVAL:\s*\w+\s+(\d{1,2}\s+\w{3})/i);
  if (arrDateExplicit) {
    segment.arrivalDate = parseDate(`${arrDateExplicit[1]} ${year}`);
  } else {
    // Check for inline date like "(Thu, Feb 5)"
    const inlineArrDate = block.match(/Arriving[\s\S]*?\(\w+,\s*(\w+)\s+(\d{1,2})\)/i);
    if (inlineArrDate) {
      const monthDay = `${inlineArrDate[2]} ${inlineArrDate[1]}`;
      segment.arrivalDate = parseDate(`${monthDay} ${year}`);
    } else {
      // Same day as departure
      segment.arrivalDate = segment.departureDate;
    }
  }

  // Terminals
  const depTerminal = block.match(/Departing\s+At:[\s\S]*?Terminal:\s*\n?\s*(.+?)(?:\n|Arriving)/i);
  if (depTerminal) {
    const term = cleanText(depTerminal[1]);
    segment.departureTerminal = term === 'Not Available' ? null : term;
  }

  const arrTerminal = block.match(/Arriving\s+At:[\s\S]*?Terminal:\s*\n?\s*(.+?)(?:\n|Passenger)/i);
  if (arrTerminal) {
    const term = cleanText(arrTerminal[1]);
    segment.arrivalTerminal = term === 'Not Available' ? null : term;
  }

  return segment;
}

/**
 * Extract departure and arrival airport pair from a segment block.
 * Ethiopian PDF format has airport codes (3 letters) followed by city names.
 * The segment block has two airport codes — first is departure, second is arrival.
 */
function extractAirportPair(block) {
  // Find lines with 3-letter airport codes followed by city info
  // Pattern: standalone 3-letter code on its own line or before a newline+city
  const airportPattern = /\b([A-Z]{3})\n([A-Z][A-Z\s,.']+?)(?:\n|$)/g;
  const airports = [];
  let match;

  while ((match = airportPattern.exec(block)) !== null) {
    const code = match[1];
    const cityLine = cleanText(match[2]);
    // Filter out non-airport codes (common words)
    if (isAirportCode(code)) {
      airports.push({ code, city: formatCity(cityLine) });
    }
  }

  if (airports.length >= 2) {
    return {
      departure: airports[0],
      arrival: airports[1],
    };
  }

  return null;
}

/**
 * Format city name from the PDF (e.g., "ADDIS ABABA, ETHIOPIA" → "Addis Ababa")
 * or "LUANDA DR A NETO, ANGOLA" → "Luanda"
 */
function formatCity(cityLine) {
  // Remove country name after comma
  const parts = cityLine.split(',');
  const city = cleanText(parts[0]);
  // Title case
  return city
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const NON_AIRPORT = new Set(['JET', 'THE', 'AND', 'FOR', 'NOT', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'JAN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

function isAirportCode(code) {
  return !NON_AIRPORT.has(code);
}


/**
 * Extract passenger information from the PDF.
 * Ethiopian PDF repeats passenger info for each segment:
 *   Passenger Name: Seats: Frequent Flyer #: eTicket Receipt(s):
 *   » Mr Gaurav Seth  Check-In Required  10087000232 / ETHIOPIAN AIRLINES  0712158238861
 */
function extractPassengers(text) {
  const passengerMap = new Map();

  // Match passenger rows: "» Mr/Mrs/Ms FirstName LastName"
  const rowPattern = /»\s*(Mr|Mrs|Ms|Miss|Dr|Mstr)\.?\s+(\w+(?:\s+\w+)*?)\s+(?:Check-In Required|\d+[A-Z])/gi;
  let match;

  while ((match = rowPattern.exec(text)) !== null) {
    const title = match[1].toUpperCase();
    const fullName = cleanText(match[2]);
    const parts = fullName.split(/\s+/);
    const firstName = parts[0] ? parts[0].toUpperCase() : null;
    const lastName = parts.slice(1).join(' ').toUpperCase() || null;
    const key = `${firstName}:${lastName}`;

    if (!passengerMap.has(key)) {
      const passenger = emptyPassenger();
      passenger.title = title;
      passenger.firstName = firstName;
      passenger.lastName = lastName;

      // Extract seat — "Check-In Required" or actual seat like "12A"
      const seatArea = text.slice(match.index, match.index + 200);
      const seatMatch = seatArea.match(/(?:Check-In Required|(\d+[A-Z]))/i);
      passenger.seat = seatMatch && seatMatch[1] ? seatMatch[1] : null;

      // Extract frequent flyer number
      const ffMatch = seatArea.match(/(\d{8,})\s*\/\s*ETHIOPIAN\s+AIRLINES/i);
      if (ffMatch) {
        passenger.frequentFlyer = {
          number: ffMatch[1],
          airline: 'Ethiopian Airlines',
        };
      }

      // Extract eTicket number
      const ticketMatch = seatArea.match(/(?:eTicket\s+Receipt\(s\):\s*)?(\d{13})/);
      if (ticketMatch) {
        passenger.ticketNumber = ticketMatch[1];
      }

      passengerMap.set(key, passenger);
    }
  }

  return Array.from(passengerMap.values());
}

/**
 * Check if an attachment is likely an Ethiopian Airlines itinerary PDF.
 */
function canParse(from, subject, attachments, htmlBody) {
  // Check sender
  if (/ethiopianairlines\.com/i.test(from)) return true;
  if (/ethiopian/i.test(subject)) return true;

  // Check email body for Ethiopian links/references
  if (htmlBody && /ethiopianairlines\.com/i.test(htmlBody)) return true;

  // Check PDF attachments for Ethiopian content
  if (attachments && attachments.length > 0) {
    return attachments.some(
      (att) =>
        att.contentType === 'application/pdf' &&
        /travel\s*reservation|ethiopian/i.test(att.filename)
    );
  }

  return false;
}

module.exports = { parse, canParse };
