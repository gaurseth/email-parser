import type { Booking, FlightSegment, Passenger, ValidationResult } from '../types';

export function validateBooking(booking: Partial<Booking> | null): ValidationResult {
  const errors: string[] = [];

  if (!booking) {
    return { valid: false, confidence: 'low', errors: ['No booking data'] };
  }

  const hasPNR = !!(booking.pnr || booking.bookingReference);
  const hasFlights = Array.isArray(booking.flights) && booking.flights.length > 0;
  const hasPassengers = Array.isArray(booking.passengers) && booking.passengers.length > 0;

  if (!hasPNR) errors.push('Missing PNR/booking reference');
  if (!hasFlights) errors.push('Missing flight information');
  if (!hasPassengers) errors.push('Missing passenger information');

  let hasCompleteFlightInfo = false;
  if (hasFlights) {
    hasCompleteFlightInfo = booking.flights!.some(
      (f) =>
        f.flightNumber &&
        f.departureAirport &&
        f.arrivalAirport &&
        f.departureDate
    );
    if (!hasCompleteFlightInfo) {
      errors.push('No flight has complete info (number + airports + date)');
    }
  }

  let confidence: ValidationResult['confidence'];
  if (hasPNR && hasCompleteFlightInfo && hasPassengers) {
    confidence = 'high';
  } else if (hasPNR && hasFlights) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    valid: hasPNR || hasFlights,
    confidence,
    errors,
  };
}

export function emptyBooking(): Booking {
  return {
    airline: { code: null, name: null },
    pnr: null,
    bookingReference: null,
    status: 'confirmed',
    passengers: [],
    flights: [],
    contact: { email: null, phone: null },
    pricing: null,
  };
}

export function emptyFlightSegment(): FlightSegment {
  return {
    flightNumber: null,
    departureAirport: null,
    departureCity: null,
    arrivalAirport: null,
    arrivalCity: null,
    departureDate: null,
    departureTime: null,
    arrivalDate: null,
    arrivalTime: null,
    departureTerminal: null,
    arrivalTerminal: null,
    cabin: null,
    bookingClass: null,
    status: 'confirmed',
    aircraft: null,
    duration: null,
    distance: null,
    meals: null,
    seat: null,
  };
}

export function emptyPassenger(): Passenger {
  return {
    title: null,
    firstName: null,
    lastName: null,
    ticketNumber: null,
    seat: null,
    frequentFlyer: null,
  };
}
