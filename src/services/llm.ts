import Anthropic from '@anthropic-ai/sdk';
import { htmlToText } from '../parsers/helpers';
import config from '../config';
import type { Booking } from '../types';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!config.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }
    client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }
  return client;
}

const SYSTEM_PROMPT = `You are an airline booking confirmation email parser. Extract structured booking data from the email content provided.

Return ONLY valid JSON matching this exact schema (no markdown, no explanation):

{
  "airline": { "code": "2-letter IATA code", "name": "Airline name" },
  "pnr": "6-character PNR/booking reference",
  "bookingReference": "same as pnr or separate booking reference",
  "status": "confirmed",
  "passengers": [
    {
      "title": "MR/MRS/MS/etc or null",
      "firstName": "FIRST NAME",
      "lastName": "LAST NAME",
      "ticketNumber": "ticket number or null"
    }
  ],
  "flights": [
    {
      "flightNumber": "XX1234",
      "departureAirport": "3-letter IATA code",
      "departureCity": "City name",
      "arrivalAirport": "3-letter IATA code",
      "arrivalCity": "City name",
      "departureDate": "YYYY-MM-DD",
      "departureTime": "HH:MM",
      "arrivalDate": "YYYY-MM-DD or null",
      "arrivalTime": "HH:MM or null",
      "terminal": "terminal or null",
      "cabin": "Economy/Business/First/Premium Economy or null",
      "status": "confirmed"
    }
  ],
  "contact": { "email": "email or null", "phone": "phone or null" },
  "pricing": { "currency": "3-letter code", "total": 0 }
}

Rules:
- Use uppercase for names, PNR, airport codes
- Use IATA codes for airports (3-letter) and airlines (2-letter)
- Dates in YYYY-MM-DD format, times in HH:MM (24-hour)
- Set fields to null if not found in the email
- If multiple flights (connecting/return), include all as separate entries in the flights array`;

export async function parse(htmlBody: string, ruleBasedHints: Partial<Booking> = {}): Promise<Partial<Booking>> {
  const anthropic = getClient();

  const plainText = htmlToText(htmlBody);
  const truncated = plainText.slice(0, 8000);

  let userMessage = `Parse this airline booking confirmation email:\n\n${truncated}`;

  if (ruleBasedHints.pnr || (ruleBasedHints.flights && ruleBasedHints.flights.length > 0)) {
    userMessage += `\n\nPartial data already extracted (verify and complete):\n${JSON.stringify(ruleBasedHints, null, 2)}`;
  }

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const content = response.content[0];
  if (!content || content.type !== 'text') {
    throw new Error('Empty response from Claude API');
  }

  const jsonStr = content.text.replace(/^```json?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();

  try {
    return JSON.parse(jsonStr) as Partial<Booking>;
  } catch (parseErr) {
    throw new Error(`Failed to parse LLM response as JSON: ${(parseErr as Error).message}`);
  }
}
