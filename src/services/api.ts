import config from '../config';
import type { Booking } from '../types';

export async function sendParsedBooking(booking: Booking & { messageId: string }): Promise<unknown> {
  if (!config.PARENT_API_URL) {
    console.log('PARENT_API_URL not configured, skipping API forwarding');
    return null;
  }

  const response = await fetch(config.PARENT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.PARENT_API_KEY && {
        Authorization: `Bearer ${config.PARENT_API_KEY}`,
      }),
    },
    body: JSON.stringify(booking),
  });

  if (!response.ok) {
    throw new Error(
      `Parent API responded with ${response.status}: ${await response.text()}`
    );
  }

  return response.json();
}
