import fs from 'fs';
import path from 'path';
import { vi } from 'vitest';
import { validateBooking } from '../../src/schema/booking';
import type { Booking, Attachment } from '../../src/types';

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

import { parse, canParse } from '../../src/parsers/taag';

const fixtureText = fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'taag-itinerary.txt'),
  'utf-8'
);

describe('TAAG Angola Airlines Parser', () => {
  let booking: Booking;

  beforeAll(async () => {
    booking = await parse(Buffer.from(fixtureText));
  });

  test('identifies airline', () => {
    expect(booking.airline.code).toBe('DT');
    expect(booking.airline.name).toBe('TAAG Angola Airlines');
  });

  test('extracts PNR / booking ref', () => {
    expect(booking.pnr).toBe('XUMA7M');
    expect(booking.bookingReference).toBe('XUMA7M');
  });

  describe('flight segments', () => {
    test('extracts both segments', () => {
      expect(booking.flights).toHaveLength(2);
    });

    describe('segment 1: LAD → CPT (DT579)', () => {
      let seg: Booking['flights'][0];
      beforeAll(() => { seg = booking.flights[0]; });

      test('flight number', () => { expect(seg.flightNumber).toBe('DT579'); });
      test('airports', () => {
        expect(seg.departureAirport).toBe('LAD');
        expect(seg.arrivalAirport).toBe('CPT');
      });
      test('cities', () => {
        expect(seg.departureCity).toBe('Luanda');
        expect(seg.arrivalCity).toBe('Cape Town');
      });
      test('departure date and time', () => {
        expect(seg.departureDate).toBe('2026-03-21');
        expect(seg.departureTime).toBe('09:00');
      });
      test('arrival time', () => {
        expect(seg.arrivalTime).toBe('14:00');
      });
      test('duration', () => {
        expect(seg.duration).toBe('4h 00m');
      });
      test('booking class and cabin', () => {
        expect(seg.bookingClass).toBe('K');
        expect(seg.cabin).toBe('Economy');
      });
      test('no seat assigned', () => {
        expect(seg.seat).toBeNull();
      });
      test('meals (VGML)', () => {
        expect(seg.meals).toBe('VGML');
      });
      test('status', () => {
        expect(seg.status).toBe('confirmed');
      });
    });

    describe('segment 2: JNB → LAD (DT578)', () => {
      let seg: Booking['flights'][0];
      beforeAll(() => { seg = booking.flights[1]; });

      test('flight number', () => { expect(seg.flightNumber).toBe('DT578'); });
      test('airports', () => {
        expect(seg.departureAirport).toBe('JNB');
        expect(seg.arrivalAirport).toBe('LAD');
      });
      test('cities', () => {
        expect(seg.departureCity).toBe('Johannesburg');
        expect(seg.arrivalCity).toBe('Luanda');
      });
      test('departure terminal (JNB Terminal A)', () => {
        expect(seg.departureTerminal).toBe('A');
      });
      test('departure date and time', () => {
        expect(seg.departureDate).toBe('2026-04-03');
        expect(seg.departureTime).toBe('16:40');
      });
      test('arrival time', () => {
        expect(seg.arrivalTime).toBe('19:45');
      });
      test('seat', () => {
        expect(seg.seat).toBe('16D');
      });
      test('duration', () => {
        expect(seg.duration).toBe('4h 05m');
      });
      test('booking class', () => {
        expect(seg.bookingClass).toBe('X');
      });
    });
  });

  describe('passenger', () => {
    test('extracts 1 passenger', () => {
      expect(booking.passengers).toHaveLength(1);
    });
    test('name and title', () => {
      const pax = booking.passengers[0];
      expect(pax.title).toBe('MRS');
      expect(pax.firstName).toBe('PRIYA');
      expect(pax.lastName).toBe('SAXENA');
    });
    test('ticket number', () => {
      expect(booking.passengers[0].ticketNumber).toBe('1182122748251');
    });
  });

  describe('pricing', () => {
    test('extracts total amount in AOA', () => {
      expect(booking.pricing).not.toBeNull();
      expect(booking.pricing!.currency).toBe('AOA');
      expect(booking.pricing!.total).toBe(865278);
    });
  });

  test('validates with high confidence', () => {
    const { valid, confidence } = validateBooking(booking);
    expect(valid).toBe(true);
    expect(confidence).toBe('high');
  });
});

describe('TAAG canParse detection', () => {
  test('matches taag.com sender', () => {
    expect(canParse('noreply@taag.com', 'Your booking', [])).toBe(true);
  });

  test('matches subject with TAAG', () => {
    expect(canParse('agent@travel.com', 'TAAG Booking Confirmation', [])).toBe(true);
  });

  test('matches Portuguese "Código de Reserva" in body', () => {
    const html = '<p>Código de Reserva | Booking Code</p><p>XUMA7M</p>';
    expect(canParse('agent@travel.com', 'Your flight', [], html)).toBe(true);
  });

  test('matches taag.com in email body', () => {
    const html = '<a href="https://www.taag.com/manage">Manage Booking</a>';
    expect(canParse('agent@travel.com', 'Your trip', [], html)).toBe(true);
  });

  test('matches PDF attachment with taag in filename', () => {
    const attachments: Attachment[] = [
      { filename: 'taag-eticket.pdf', contentType: 'application/pdf', buffer: Buffer.from('') },
    ];
    expect(canParse('agent@travel.com', 'Your trip', attachments)).toBe(true);
  });

  test('does not match unrelated email', () => {
    expect(canParse('noreply@indigo.com', 'IndiGo Booking', [])).toBe(false);
  });
});
