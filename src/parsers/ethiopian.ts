import { PDFParse } from 'pdf-parse';
import { cleanText, parseDate, parseTime } from './helpers';
import { emptyBooking, emptyFlightSegment, emptyPassenger } from '../schema/booking';
import type { Booking, FlightSegment, Passenger, Attachment } from '../types';

interface AirportInfo {
  code: string;
  city: string;
}

interface AirportPair {
  departure: AirportInfo;
  arrival: AirportInfo;
}

export async function parse(pdfBuffer: Buffer): Promise<Booking> {
  const pdf = new PDFParse({ data: pdfBuffer }) as any;
  await pdf.load();
  const result = await pdf.getText();
  const text: string = result.text;

  const booking = emptyBooking();
  booking.airline = { code: 'ET', name: 'Ethiopian Airlines' };

  const pnrMatch = text.match(/RESERVATION\s+CODE\s+([A-Z0-9]{5,6})/i);
  if (pnrMatch) {
    booking.pnr = pnrMatch[1].toUpperCase();
    booking.bookingReference = booking.pnr;
  }

  const tripMatch = text.match(/TRIP\s+TO\s+(.+)/i);
  if (tripMatch) {
    booking.tripDescription = cleanText(tripMatch[1]);
  }

  booking.flights = extractFlightSegments(text);
  booking.passengers = extractPassengers(text);

  return booking;
}

function extractFlightSegments(text: string): FlightSegment[] {
  const segments: FlightSegment[] = [];

  const depPattern = /DEPARTURE:\s*\w+\s+(\d{1,2}\s+\w{3})/g;
  const depMatches: { index: number; dateStr: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = depPattern.exec(text)) !== null) {
    depMatches.push({ index: match.index, dateStr: match[1] });
  }

  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();

  for (let i = 0; i < depMatches.length; i++) {
    const startIdx = depMatches[i].index;
    const endIdx = i + 1 < depMatches.length ? depMatches[i + 1].index : text.length;
    const block = text.slice(startIdx, endIdx);

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

function parseSegmentBlock(block: string, flightNumber: string, depDateStr: string, year: string): FlightSegment {
  const segment = emptyFlightSegment();
  segment.flightNumber = flightNumber;

  segment.departureDate = parseDate(`${depDateStr} ${year}`);

  const durationMatch = block.match(/Duration:\s*\n?\s*(\d+)hr\(s\)\s*(\d+)min\(s\)/i);
  if (durationMatch) {
    segment.duration = `${durationMatch[1]}h ${durationMatch[2]}m`;
  }

  const cabinMatch = block.match(/Cabin:\s*\n?\s*(\w[\w\s]*?)\s*\/\s*([A-Z])/i);
  if (cabinMatch) {
    segment.cabin = cleanText(cabinMatch[1]);
    segment.bookingClass = cabinMatch[2].toUpperCase();
  }

  const statusMatch = block.match(/Status:\s*\n?\s*(\w+)/i);
  if (statusMatch) {
    segment.status = statusMatch[1].toLowerCase();
  }

  const aircraftMatch = block.match(/Aircraft:\s*\n?\s*(.+?)(?:\n|$)/i);
  if (aircraftMatch) {
    segment.aircraft = cleanText(aircraftMatch[1]);
  }

  const distanceMatch = block.match(/Aircraft:\s*\n?\s*.+?\n(\d{3,5})\n/i);
  if (distanceMatch) {
    segment.distance = { value: parseInt(distanceMatch[1]), unit: 'miles' };
  }

  const mealsMatch = block.match(/Meals:\s*\n?\s*(.+?)(?:\n|$)/i);
  if (mealsMatch) {
    segment.meals = cleanText(mealsMatch[1]);
  }

  const airportPairs = extractAirportPair(block);
  if (airportPairs) {
    segment.departureAirport = airportPairs.departure.code;
    segment.departureCity = airportPairs.departure.city;
    segment.arrivalAirport = airportPairs.arrival.code;
    segment.arrivalCity = airportPairs.arrival.city;
  }

  const depTimeMatch = block.match(/Departing\s+At:\s*\n?\s*(\d{1,2}:\d{2}\s*(?:am|pm))/i);
  if (depTimeMatch) {
    segment.departureTime = parseTime(depTimeMatch[1]);
  }

  const arrTimeMatch = block.match(/Arriving\s+At:\s*\n?\s*(\d{1,2}:\d{2}\s*(?:am|pm))/i);
  if (arrTimeMatch) {
    segment.arrivalTime = parseTime(arrTimeMatch[1]);
  }

  const arrDateExplicit = block.match(/ARRIVAL:\s*\w+\s+(\d{1,2}\s+\w{3})/i);
  if (arrDateExplicit) {
    segment.arrivalDate = parseDate(`${arrDateExplicit[1]} ${year}`);
  } else {
    const inlineArrDate = block.match(/Arriving[\s\S]*?\(\w+,\s*(\w+)\s+(\d{1,2})\)/i);
    if (inlineArrDate) {
      const monthDay = `${inlineArrDate[2]} ${inlineArrDate[1]}`;
      segment.arrivalDate = parseDate(`${monthDay} ${year}`);
    } else {
      segment.arrivalDate = segment.departureDate;
    }
  }

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

function extractAirportPair(block: string): AirportPair | null {
  const airportPattern = /\b([A-Z]{3})\n([A-Z][A-Z\s,.']+?)(?:\n|$)/g;
  const airports: AirportInfo[] = [];
  let match: RegExpExecArray | null;

  while ((match = airportPattern.exec(block)) !== null) {
    const code = match[1];
    const cityLine = cleanText(match[2]);
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

function formatCity(cityLine: string): string {
  const parts = cityLine.split(',');
  const city = cleanText(parts[0]);
  return city
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const NON_AIRPORT = new Set(['JET', 'THE', 'AND', 'FOR', 'NOT', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'JAN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

function isAirportCode(code: string): boolean {
  return !NON_AIRPORT.has(code);
}

function extractPassengers(text: string): Passenger[] {
  const passengerMap = new Map<string, Passenger>();

  const rowPattern = /»\s*(Mr|Mrs|Ms|Miss|Dr|Mstr)\.?\s+(\w+(?:\s+\w+)*?)\s+(?:Check-In Required|\d+[A-Z])/gi;
  let match: RegExpExecArray | null;

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

      const seatArea = text.slice(match.index, match.index + 200);
      const seatMatch = seatArea.match(/(?:Check-In Required|(\d+[A-Z]))/i);
      passenger.seat = seatMatch?.[1] ?? null;

      const ffMatch = seatArea.match(/(\d{8,})\s*\/\s*ETHIOPIAN\s+AIRLINES/i);
      if (ffMatch) {
        passenger.frequentFlyer = {
          number: ffMatch[1],
          airline: 'Ethiopian Airlines',
        };
      }

      const ticketMatch = seatArea.match(/(?:eTicket\s+Receipt\(s\):\s*)?(\d{13})/);
      if (ticketMatch) {
        passenger.ticketNumber = ticketMatch[1];
      }

      passengerMap.set(key, passenger);
    }
  }

  return Array.from(passengerMap.values());
}

export function canParse(from: string, subject: string, attachments: Attachment[], htmlBody?: string): boolean {
  if (/ethiopianairlines\.com/i.test(from)) return true;
  if (/ethiopian/i.test(subject)) return true;

  if (htmlBody && /ethiopianairlines\.com/i.test(htmlBody)) return true;

  if (attachments && attachments.length > 0) {
    return attachments.some(
      (att) =>
        att.contentType === 'application/pdf' &&
        /travel\s*reservation|ethiopian/i.test(att.filename)
    );
  }

  return false;
}
