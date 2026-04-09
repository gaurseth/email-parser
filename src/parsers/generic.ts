import {
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
} from './helpers';
import { emptyBooking } from '../schema/booking';
import type { Booking } from '../types';

const AIRLINE_MAP: Record<string, string> = {
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

export function parse(htmlBody: string): Booking {
  const $ = loadHtml(htmlBody);
  const text = htmlToText(htmlBody);

  const booking = emptyBooking();

  booking.pnr = extractPNR(text);
  booking.bookingReference = booking.pnr;

  const flightNumbers = extractFlightNumbers(text);
  const airportCodes = extractAirportCodes(text);
  const dates = extractDates(text);
  const times = extractTimes(text);

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
      departureTerminal: null,
      arrivalTerminal: null,
      cabin: extractCabin(text),
      bookingClass: null,
      status: 'confirmed',
      aircraft: null,
      duration: null,
      distance: null,
      meals: null,
    };

    booking.flights.push(flight);
  }

  booking.passengers = extractPassengerNames(text).map((p) => ({
    ...p,
    ticketNumber: null,
    seat: null,
    frequentFlyer: null,
  }));

  booking.pricing = extractPricing(text);

  booking.contact.email = extractEmail(text);
  booking.contact.phone = extractPhone(text);

  return booking;
}

function extractCabin(text: string): string | null {
  const cabinPatterns: { pattern: RegExp; value: string }[] = [
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

function extractEmail(text: string): string | null {
  const match = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0] : null;
}

function extractPhone(text: string): string | null {
  const match = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  return match ? match[0] : null;
}
