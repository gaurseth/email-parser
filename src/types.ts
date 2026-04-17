export interface Airline {
  code: string | null;
  name: string | null;
}

export interface Distance {
  value: number;
  unit: string;
}

export interface FlightSegment {
  flightNumber: string | null;
  departureAirport: string | null;
  departureCity: string | null;
  arrivalAirport: string | null;
  arrivalCity: string | null;
  departureDate: string | null;
  departureTime: string | null;
  arrivalDate: string | null;
  arrivalTime: string | null;
  departureTerminal: string | null;
  arrivalTerminal: string | null;
  cabin: string | null;
  bookingClass: string | null;
  status: string;
  aircraft: string | null;
  duration: string | null;
  distance: Distance | null;
  meals: string | null;
  seat: string | null;
}

export interface FrequentFlyer {
  number: string;
  airline: string;
}

export interface Passenger {
  title: string | null;
  firstName: string | null;
  lastName: string | null;
  ticketNumber: string | null;
  seat: string | null;
  frequentFlyer: FrequentFlyer | null;
}

export interface Pricing {
  currency: string;
  total: number | null;
}

export interface Contact {
  email: string | null;
  phone: string | null;
}

export interface Booking {
  airline: Airline;
  pnr: string | null;
  bookingReference: string | null;
  status: string;
  passengers: Passenger[];
  flights: FlightSegment[];
  contact: Contact;
  pricing: Pricing | null;
  tripDescription?: string;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface ValidationResult {
  valid: boolean;
  confidence: Confidence;
  errors: string[];
}

export type ParseStatus = 'parsed' | 'skipped' | 'failed';

export interface ParseResultParsed {
  status: 'parsed';
  booking: Booking;
  confidence: Confidence;
  parserUsed: string;
  errors: string[];
}

export interface ParseResultSkipped {
  status: 'skipped';
  reason: string;
}

export interface ParseResultFailed {
  status: 'failed';
  booking: Booking;
  confidence: Confidence;
  parserUsed: string;
  errors: string[];
}

export type ParseResult = ParseResultParsed | ParseResultSkipped | ParseResultFailed;

export interface AttachmentMeta {
  filename: string;
  contentType: string;
  gcsUri: string;
  size?: number;
}

export interface Attachment {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

export interface EmailMetadata {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  bodyPlainSnippet?: string;
  storagePath: string;
  attachments?: AttachmentMeta[];
  [key: string]: unknown;
}

export interface PubSubMessageData {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  storagePath: string;
  attachmentCount: number;
  receivedAt: string;
}

export interface AirlineParser {
  id: string;
  canParse: (from: string, subject: string, attachments: Attachment[], htmlBody?: string) => boolean;
  parse: (buffer: Buffer) => Promise<Booking>;
}
