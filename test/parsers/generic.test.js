const fs = require('fs');
const path = require('path');
const { parse } = require('../../src/parsers/generic');
const { validateBooking } = require('../../src/schema/booking');
const { isBookingEmail } = require('../../src/parsers');

const fixturesDir = path.join(__dirname, '..', 'fixtures');

function loadFixture(filename) {
  return fs.readFileSync(path.join(fixturesDir, filename), 'utf-8');
}

describe('Generic Parser', () => {
  describe('sample booking email', () => {
    let booking;

    beforeAll(() => {
      const html = loadFixture('sample-booking.html');
      booking = parse(html);
    });

    test('extracts PNR', () => {
      expect(booking.pnr).toBe('AB3K7X');
    });

    test('identifies airline from flight number', () => {
      expect(booking.airline.code).toBe('6E');
      expect(booking.airline.name).toBe('IndiGo');
    });

    test('extracts flight number', () => {
      expect(booking.flights).toHaveLength(1);
      expect(booking.flights[0].flightNumber).toBe('6E2341');
    });

    test('extracts airport codes', () => {
      expect(booking.flights[0].departureAirport).toBe('DEL');
      expect(booking.flights[0].arrivalAirport).toBe('BOM');
    });

    test('extracts departure date', () => {
      expect(booking.flights[0].departureDate).toBe('2026-05-15');
    });

    test('extracts times', () => {
      expect(booking.flights[0].departureTime).toBe('09:30');
      expect(booking.flights[0].arrivalTime).toBe('11:45');
    });

    test('extracts cabin class', () => {
      expect(booking.flights[0].cabin).toBe('Economy');
    });

    test('extracts passenger name', () => {
      expect(booking.passengers).toHaveLength(1);
      expect(booking.passengers[0].firstName).toBe('GAURAV');
      expect(booking.passengers[0].lastName).toBe('SHARMA');
      expect(booking.passengers[0].title).toBe('MR');
    });

    test('extracts pricing', () => {
      expect(booking.pricing).not.toBeNull();
      expect(booking.pricing.currency).toBe('INR');
      expect(booking.pricing.total).toBe(5500);
    });

    test('extracts contact info', () => {
      expect(booking.contact.email).toBe('gaurav@example.com');
    });

    test('validates with high confidence', () => {
      const { valid, confidence } = validateBooking(booking);
      expect(valid).toBe(true);
      expect(confidence).toBe('high');
    });
  });

  describe('multi-segment booking', () => {
    let booking;

    beforeAll(() => {
      const html = loadFixture('multi-segment.html');
      booking = parse(html);
    });

    test('extracts PNR', () => {
      expect(booking.pnr).toBe('XY9M2P');
    });

    test('identifies Emirates', () => {
      expect(booking.airline.code).toBe('EK');
      expect(booking.airline.name).toBe('Emirates');
    });

    test('extracts both flight segments', () => {
      expect(booking.flights).toHaveLength(2);
      expect(booking.flights[0].flightNumber).toBe('EK524');
      expect(booking.flights[1].flightNumber).toBe('EK525');
    });

    test('extracts airport codes for segments', () => {
      expect(booking.flights[0].departureAirport).toBe('DXB');
      expect(booking.flights[0].arrivalAirport).toBe('BOM');
      expect(booking.flights[1].departureAirport).toBe('BOM');
      expect(booking.flights[1].arrivalAirport).toBe('DXB');
    });

    test('extracts dates for each segment', () => {
      expect(booking.flights[0].departureDate).toBe('2026-06-20');
      expect(booking.flights[1].departureDate).toBe('2026-06-27');
    });

    test('extracts cabin class', () => {
      expect(booking.flights[0].cabin).toBe('Business');
    });

    test('validates with high confidence', () => {
      const { valid, confidence } = validateBooking(booking);
      expect(valid).toBe(true);
      expect(confidence).toBe('high');
    });
  });
});

describe('Booking Detection', () => {
  test('identifies booking confirmation email', () => {
    const html = loadFixture('sample-booking.html');
    const text = require('../../src/parsers/helpers').htmlToText(html);
    expect(isBookingEmail('Your Booking Confirmation - 6E 2341', text)).toBe(true);
  });

  test('rejects non-booking email', () => {
    const html = loadFixture('non-booking.html');
    const text = require('../../src/parsers/helpers').htmlToText(html);
    expect(isBookingEmail('Special Offer!', text)).toBe(false);
  });
});

describe('Schema Validation', () => {
  test('returns low confidence for empty booking', () => {
    const { valid, confidence } = validateBooking({
      pnr: null,
      flights: [],
      passengers: [],
    });
    expect(valid).toBe(false);
    expect(confidence).toBe('low');
  });

  test('returns medium confidence for PNR + partial flight', () => {
    const { valid, confidence } = validateBooking({
      pnr: 'ABC123',
      flights: [{ flightNumber: '6E100' }],
      passengers: [],
    });
    expect(valid).toBe(true);
    expect(confidence).toBe('medium');
  });
});
