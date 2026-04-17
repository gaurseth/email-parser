import { PDFParse } from 'pdf-parse';
import { cleanText, parseDate, parseTime } from './helpers';
import { emptyBooking, emptyFlightSegment, emptyPassenger } from '../schema/booking';
import type { Booking, FlightSegment, Passenger, Attachment, Pricing } from '../types';

/**
 * TAAG Angola Airlines destination name → IATA code mapping.
 * Add entries here as new destinations are encountered.
 */
const TAAG_AIRPORTS: { match: RegExp; code: string; name: string }[] = [
  { match: /\bLUANDA\b/i, code: 'LAD', name: 'Luanda' },
  { match: /\bCAPE\s+TOWN\b/i, code: 'CPT', name: 'Cape Town' },
  { match: /\bJOHANNESBURG\b/i, code: 'JNB', name: 'Johannesburg' },
  { match: /\bLISBOA\b|\bLISBON\b/i, code: 'LIS', name: 'Lisbon' },
  { match: /\bPORTO\b/i, code: 'OPO', name: 'Porto' },
  { match: /\bRIO\s+DE\s+JANEIRO\b/i, code: 'GIG', name: 'Rio de Janeiro' },
  { match: /\bSAO\s+PAULO\b|\bS\u00c3O\s+PAULO\b/i, code: 'GRU', name: 'Sao Paulo' },
  { match: /\bBRASILIA\b/i, code: 'BSB', name: 'Brasilia' },
  { match: /\bHAVANA\b/i, code: 'HAV', name: 'Havana' },
  { match: /\bWINDHOEK\b/i, code: 'WDH', name: 'Windhoek' },
  { match: /\bHARARE\b/i, code: 'HRE', name: 'Harare' },
  { match: /\bLUSAKA\b/i, code: 'LUN', name: 'Lusaka' },
  { match: /\bMAPUTO\b/i, code: 'MPM', name: 'Maputo' },
  { match: /\bNAMIBE\b/i, code: 'MSZ', name: 'Namibe' },
  { match: /\bSOYO\b/i, code: 'SZA', name: 'Soyo' },
  { match: /\bCABINDA\b/i, code: 'CAB', name: 'Cabinda' },
  { match: /\bDUBAI\b/i, code: 'DXB', name: 'Dubai' },
  { match: /\bBEIJING\b/i, code: 'PEK', name: 'Beijing' },
  { match: /\bLONDON\b/i, code: 'LHR', name: 'London' },
  { match: /\bPARIS\b/i, code: 'CDG', name: 'Paris' },
  { match: /\bBENGUELA\b/i, code: 'BUG', name: 'Benguela' },
  { match: /\bHUAMBO\b/i, code: 'NOV', name: 'Huambo' },
  { match: /\bLUBANGO\b/i, code: 'SDD', name: 'Lubango' },
  { match: /\bMENONGUE\b/i, code: 'SPP', name: 'Menongue' },
];

interface AirportInfo {
  code: string;
  name: string;
  pos: number;
}

export async function parse(pdfBuffer: Buffer): Promise<Booking> {
  const pdf = new PDFParse({ data: pdfBuffer }) as any;
  await pdf.load();
  const result = await pdf.getText();
  const text: string = result.text;

  const booking = emptyBooking();
  booking.airline = { code: 'DT', name: 'TAAG Angola Airlines' };

  // PNR / Booking reference
  const pnrMatch = text.match(/Booking\s+ref:\s*([A-Z0-9]{5,7})/i);
  if (pnrMatch) {
    booking.pnr = pnrMatch[1].toUpperCase();
    booking.bookingReference = booking.pnr;
  }

  // Ticket number (e.g., "118 2122748251")
  const ticketMatch = text.match(/Ticket\s+number:\s*(\d{3}\s*\d{9,})/i);
  const ticketNumber = ticketMatch ? ticketMatch[1].replace(/\s+/g, '') : null;

  // Passenger
  const passenger = extractPassenger(text, ticketNumber);
  if (passenger) booking.passengers = [passenger];

  // Flight segments
  booking.flights = extractFlightSegments(text);

  // Pricing
  const pricing = extractPricing(text);
  if (pricing) booking.pricing = pricing;

  return booking;
}

function extractPassenger(text: string, ticketNumber: string | null): Passenger | null {
  const paxMatch = text.match(/Passenger:\s*(.+?)(?:\n|$)/i);
  if (!paxMatch) return null;

  const passengerLine = cleanText(paxMatch[1]);
  // Format: "Saxena Priya Mrs" (LastName FirstName Title)
  const parts = passengerLine.split(/\s+/);
  if (parts.length < 2) return null;

  const passenger = emptyPassenger();

  // Title is typically the last token (Mr/Mrs/Ms/...)
  const lastWord = parts[parts.length - 1];
  let nameParts = parts;
  if (/^(Mr|Mrs|Ms|Miss|Dr|Mstr)\.?$/i.test(lastWord)) {
    passenger.title = lastWord.toUpperCase().replace('.', '');
    nameParts = parts.slice(0, -1);
  }

  // TAAG puts surname first
  passenger.lastName = nameParts[0]?.toUpperCase() || null;
  passenger.firstName = nameParts.slice(1).join(' ').toUpperCase() || null;
  passenger.ticketNumber = ticketNumber;

  return passenger;
}

function extractFlightSegments(text: string): FlightSegment[] {
  const lines = text.split('\n');
  const segments: FlightSegment[] = [];

  // Find all line indices with "DT### HH:MM" flight pattern
  const flightLineIndices: number[] = [];
  lines.forEach((line, idx) => {
    if (/^\s*DT\s*\d{3,4}\s+\d{1,2}:\d{2}/.test(line)) {
      flightLineIndices.push(idx);
    }
  });

  if (flightLineIndices.length === 0) return segments;

  // Find "From To Flight..." header line — marks start of itinerary
  const headerIdx = lines.findIndex((l) => /From\s+To\s+Flight/.test(l));

  // Year fallback (all TAAG tickets include date lines with the year)
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();

  for (let i = 0; i < flightLineIndices.length; i++) {
    const flightIdx = flightLineIndices[i];

    // Preceding block (where airports appear): from previous flight's end (or header) to this flight
    const blockStart = i === 0 ? headerIdx + 1 : flightLineIndices[i - 1] + 3; // +3 skips flight+date+arrival
    const airportBlock = lines.slice(Math.max(0, blockStart), flightIdx).join('\n');

    // Details block: from flight line to next flight (or end)
    const detailsEnd = i + 1 < flightLineIndices.length ? flightLineIndices[i + 1] : lines.length;
    const detailsBlock = lines.slice(flightIdx, detailsEnd).join('\n');

    const flightMatch = lines[flightIdx].trim().match(/^(DT)\s*(\d{3,4})/);
    if (!flightMatch) continue;
    const flightNum = `${flightMatch[1]}${flightMatch[2]}`;

    const segment = parseSegmentBlock(airportBlock, detailsBlock, flightNum, year);
    if (segment) segments.push(segment);
  }

  return segments;
}

function parseSegmentBlock(
  airportBlock: string,
  detailsBlock: string,
  flightNumber: string,
  year: string,
): FlightSegment {
  const segment = emptyFlightSegment();
  segment.flightNumber = flightNumber;

  // Airports (from/to)
  const airports = findAirportsInOrder(airportBlock);
  if (airports[0]) {
    segment.departureAirport = airports[0].code;
    segment.departureCity = airports[0].name;
  }
  if (airports[1]) {
    segment.arrivalAirport = airports[1].code;
    segment.arrivalCity = airports[1].name;
  }

  // Terminal — determine which airport it belongs to based on position
  const terminalMatch = airportBlock.match(/Terminal:\s*([^\n]+)/i);
  if (terminalMatch) {
    const termPos = airportBlock.indexOf(terminalMatch[0]);
    const fromPos = airports[0]?.pos ?? -1;
    const toPos = airports[1]?.pos ?? Infinity;

    if (termPos >= fromPos && termPos < toPos) {
      segment.departureTerminal = cleanText(terminalMatch[1]);
    } else if (termPos >= toPos) {
      segment.arrivalTerminal = cleanText(terminalMatch[1]);
    }
  }

  // Flight line: "DT579 09:00\n21Mar2026\n14:00"
  const flightLineMatch = detailsBlock.match(
    new RegExp(`${flightNumber}\\s+(\\d{1,2}:\\d{2})\\s*\\n\\s*(\\d{1,2}[A-Za-z]{3}\\d{4})\\s*\\n\\s*(\\d{1,2}:\\d{2})`),
  );
  if (flightLineMatch) {
    segment.departureTime = parseTime(flightLineMatch[1]);
    segment.departureDate = parseTaagDate(flightLineMatch[2]);
    segment.arrivalTime = parseTime(flightLineMatch[3]);
    segment.arrivalDate = segment.departureDate; // TAAG shows same-day unless multi-day
  }

  // Booking class (single letter)
  const classMatch = detailsBlock.match(/Class:\s*([A-Z])\b/);
  if (classMatch) {
    segment.bookingClass = classMatch[1].toUpperCase();
    segment.cabin = inferCabin(segment.bookingClass);
  }

  // Seat (only present if assigned, e.g., "Seat: 16D")
  const seatMatch = detailsBlock.match(/Seat:\s*(\d+[A-Z])\b/i);
  if (seatMatch) segment.seat = seatMatch[1];

  // Duration: "Duration: 04:00"
  const durationMatch = detailsBlock.match(/Duration:\s*(\d{1,2}):(\d{2})/i);
  if (durationMatch) {
    segment.duration = `${parseInt(durationMatch[1])}h ${durationMatch[2]}m`;
  }

  // Meals — from Special Service Request (e.g., VGML, VLML)
  const mealsMatch = detailsBlock.match(/\b(VGML|VLML|AVML|HNML|KSML|BBML|CHML|DBML|FPML|GFML|LCML|LSML|MOML|NLML|RVML)\b/i);
  if (mealsMatch) {
    segment.meals = mealsMatch[1].toUpperCase();
  }

  // Status: "Booking status (1): OK"
  const statusMatch = detailsBlock.match(/Booking\s+status\s*(?:\(\d+\))?:\s*([A-Z]+)/i);
  if (statusMatch) {
    const status = statusMatch[1].toUpperCase();
    segment.status = status === 'OK' ? 'confirmed' : status.toLowerCase();
  }

  return segment;
}

function findAirportsInOrder(block: string): AirportInfo[] {
  const found: AirportInfo[] = [];

  for (const airport of TAAG_AIRPORTS) {
    const regex = new RegExp(airport.match.source, airport.match.flags.replace('g', '') + 'g');
    let m: RegExpExecArray | null;
    while ((m = regex.exec(block)) !== null) {
      found.push({ code: airport.code, name: airport.name, pos: m.index });
    }
  }

  found.sort((a, b) => a.pos - b.pos);

  // Deduplicate consecutive same codes (handles "CAPE TOWN CAPE TOWN INTL" duplication)
  const unique: AirportInfo[] = [];
  for (const a of found) {
    if (unique.length === 0 || unique[unique.length - 1].code !== a.code) {
      unique.push(a);
    }
  }

  return unique;
}

function parseTaagDate(dateStr: string): string | null {
  // TAAG format: "21Mar2026" (no spaces) — convert to space-separated for parseDate
  const match = dateStr.match(/(\d{1,2})([A-Za-z]{3})(\d{4})/);
  if (!match) return parseDate(dateStr);
  return parseDate(`${match[1]} ${match[2]} ${match[3]}`);
}

function inferCabin(bookingClass: string): string | null {
  const businessClasses = new Set(['C', 'J', 'D', 'I', 'Z']);
  const firstClasses = new Set(['F', 'A', 'P']);
  if (businessClasses.has(bookingClass)) return 'Business';
  if (firstClasses.has(bookingClass)) return 'First';
  return 'Economy';
}

function extractPricing(text: string): Pricing | null {
  // Total Amount: AOA 865278
  const totalMatch = text.match(/Total\s+Amount:\s*([A-Z]{3})\s*([\d,]+\.?\d*)/i);
  if (totalMatch) {
    return {
      currency: totalMatch[1].toUpperCase(),
      total: parseFloat(totalMatch[2].replace(/,/g, '')) || null,
    };
  }

  // Fare: USD 619.00
  const fareMatch = text.match(/\bFare:\s*([A-Z]{3})\s*([\d,]+\.?\d*)/i);
  if (fareMatch) {
    return {
      currency: fareMatch[1].toUpperCase(),
      total: parseFloat(fareMatch[2].replace(/,/g, '')) || null,
    };
  }

  return null;
}

export function canParse(from: string, subject: string, attachments: Attachment[], htmlBody?: string): boolean {
  // Sender domain
  if (/taag\.com|taag-angola/i.test(from)) return true;

  // Subject
  if (/\btaag\b/i.test(subject)) return true;

  // Email body references
  if (htmlBody) {
    if (/taag\.com|taag\s+angola/i.test(htmlBody)) return true;
    // Portuguese booking code label unique to TAAG's emails
    if (/C\u00f3digo\s+de\s+Reserva/i.test(htmlBody)) return true;
  }

  // PDF attachments
  if (attachments && attachments.length > 0) {
    return attachments.some(
      (att) =>
        att.contentType === 'application/pdf' &&
        /taag|eticket|electronic\s+ticket/i.test(att.filename),
    );
  }

  return false;
}
