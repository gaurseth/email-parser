import fs from 'fs';
import path from 'path';
import { vi } from 'vitest';
import { validateBooking } from '../../src/schema/booking';
import type { Booking, Attachment } from '../../src/types';

// Mock pdf-parse to return the text from our fixture file
vi.mock('pdf-parse', () => {
  return {
    PDFParse: class {
      private _data: Buffer;
      constructor(opts: { data: Buffer }) { this._data = opts.data; }
      async load() {}
      async getText() { return { text: this._data.toString('utf-8') }; }
    },
  };
});

import { parse, canParse } from '../../src/parsers/ethiopian';

const fixtureText = fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'ethiopian-itinerary.txt'),
  'utf-8'
);

describe('Ethiopian Airlines Parser', () => {
  let booking: Booking;

  beforeAll(async () => {
    booking = await parse(Buffer.from(fixtureText));
  });

  test('identifies airline', () => {
    expect(booking.airline.code).toBe('ET');
    expect(booking.airline.name).toBe('Ethiopian Airlines');
  });

  test('extracts PNR / reservation code', () => {
    expect(booking.pnr).toBe('IOWAPL');
    expect(booking.bookingReference).toBe('IOWAPL');
  });

  test('extracts trip description', () => {
    expect(booking.tripDescription).toContain('DELHI');
  });

  describe('flight segments', () => {
    test('extracts all 4 segments', () => {
      expect(booking.flights).toHaveLength(4);
    });

    describe('segment 1: NBJ → ADD (ET0850)', () => {
      let seg: Booking['flights'][0];
      beforeAll(() => { seg = booking.flights[0]; });

      test('flight number', () => { expect(seg.flightNumber).toBe('ET0850'); });
      test('airports', () => {
        expect(seg.departureAirport).toBe('NBJ');
        expect(seg.arrivalAirport).toBe('ADD');
      });
      test('cities', () => {
        expect(seg.departureCity).toContain('Luanda');
        expect(seg.arrivalCity).toContain('Addis Ababa');
      });
      test('departure date', () => { expect(seg.departureDate).toBe('2026-02-04'); });
      test('times', () => {
        expect(seg.departureTime).toBe('14:05');
        expect(seg.arrivalTime).toBe('20:40');
      });
      test('cabin and booking class', () => {
        expect(seg.cabin).toBe('Economy');
        expect(seg.bookingClass).toBe('V');
      });
      test('aircraft', () => { expect(seg.aircraft).toContain('787-9'); });
      test('duration', () => { expect(seg.duration).toBe('4h 35m'); });
      test('distance', () => { expect(seg.distance).toEqual({ value: 2138, unit: 'miles' }); });
      test('meals', () => { expect(seg.meals).toBe('Lunch'); });
      test('terminals', () => {
        expect(seg.departureTerminal).toBeNull();
        expect(seg.arrivalTerminal).toBe('TERMINAL 2');
      });
      test('status', () => { expect(seg.status).toBe('confirmed'); });
    });

    describe('segment 2: ADD → DEL (ET0686)', () => {
      let seg: Booking['flights'][0];
      beforeAll(() => { seg = booking.flights[1]; });

      test('flight number', () => { expect(seg.flightNumber).toBe('ET0686'); });
      test('airports', () => {
        expect(seg.departureAirport).toBe('ADD');
        expect(seg.arrivalAirport).toBe('DEL');
      });
      test('departure date', () => { expect(seg.departureDate).toBe('2026-02-04'); });
      test('arrival date (next day)', () => { expect(seg.arrivalDate).toBe('2026-02-05'); });
      test('times', () => {
        expect(seg.departureTime).toBe('23:40');
        expect(seg.arrivalTime).toBe('08:05');
      });
      test('cabin and booking class', () => {
        expect(seg.cabin).toBe('Economy');
        expect(seg.bookingClass).toBe('V');
      });
      test('terminals', () => {
        expect(seg.departureTerminal).toBe('TERMINAL 2');
        expect(seg.arrivalTerminal).toBe('TERMINAL 3');
      });
    });

    describe('segment 3: DEL → ADD (ET0687)', () => {
      let seg: Booking['flights'][0];
      beforeAll(() => { seg = booking.flights[2]; });

      test('flight number', () => { expect(seg.flightNumber).toBe('ET0687'); });
      test('airports', () => {
        expect(seg.departureAirport).toBe('DEL');
        expect(seg.arrivalAirport).toBe('ADD');
      });
      test('departure date', () => { expect(seg.departureDate).toBe('2026-02-17'); });
      test('times', () => {
        expect(seg.departureTime).toBe('02:25');
        expect(seg.arrivalTime).toBe('06:30');
      });
      test('cabin and booking class', () => {
        expect(seg.cabin).toBe('Economy');
        expect(seg.bookingClass).toBe('K');
      });
    });

    describe('segment 4: ADD → NBJ (ET0851)', () => {
      let seg: Booking['flights'][0];
      beforeAll(() => { seg = booking.flights[3]; });

      test('flight number', () => { expect(seg.flightNumber).toBe('ET0851'); });
      test('airports', () => {
        expect(seg.departureAirport).toBe('ADD');
        expect(seg.arrivalAirport).toBe('NBJ');
      });
      test('departure date', () => { expect(seg.departureDate).toBe('2026-02-17'); });
      test('times', () => {
        expect(seg.departureTime).toBe('09:50');
        expect(seg.arrivalTime).toBe('12:35');
      });
      test('aircraft', () => { expect(seg.aircraft).toContain('777-200LR'); });
      test('duration', () => { expect(seg.duration).toBe('4h 45m'); });
    });
  });

  describe('passengers', () => {
    test('extracts 1 passenger (deduplicated)', () => {
      expect(booking.passengers).toHaveLength(1);
    });

    test('passenger name', () => {
      const pax = booking.passengers[0];
      expect(pax.title).toBe('MR');
      expect(pax.firstName).toBe('GAURAV');
      expect(pax.lastName).toBe('SETH');
    });

    test('frequent flyer', () => {
      const pax = booking.passengers[0];
      expect(pax.frequentFlyer).not.toBeNull();
      expect(pax.frequentFlyer!.number).toBe('10087000232');
      expect(pax.frequentFlyer!.airline).toBe('Ethiopian Airlines');
    });

    test('ticket number', () => {
      const pax = booking.passengers[0];
      expect(pax.ticketNumber).toBe('0712158238861');
    });
  });

  test('validates with high confidence', () => {
    const { valid, confidence } = validateBooking(booking);
    expect(valid).toBe(true);
    expect(confidence).toBe('high');
  });
});

describe('Ethiopian canParse detection', () => {
  test('matches ethiopianairlines.com sender', () => {
    expect(canParse('noreply@ethiopianairlines.com', 'Your booking', [])).toBe(true);
  });

  test('matches subject with Ethiopian', () => {
    expect(canParse('agent@travel.com', 'Ethiopian Airlines Confirmation', [])).toBe(true);
  });

  test('matches ethiopianairlines.com in email body', () => {
    const html = '<a href="https://www.ethiopianairlines.com/manage">Manage Booking</a>';
    expect(canParse('agent@travel.com', 'Your trip', [], html)).toBe(true);
  });

  test('matches PDF attachment with travel reservation filename', () => {
    const attachments: Attachment[] = [
      { filename: 'Travel Reservation.pdf', contentType: 'application/pdf', buffer: Buffer.from('') },
    ];
    expect(canParse('agent@travel.com', 'Your trip', attachments)).toBe(true);
  });

  test('does not match unrelated email', () => {
    expect(canParse('noreply@indigo.com', 'IndiGo Booking', [])).toBe(false);
  });
});
