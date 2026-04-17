import { GoogleAuth, IdTokenClient } from 'google-auth-library';
import config from '../config';
import type { Booking } from '../types';

const auth = new GoogleAuth();

let idTokenClient: IdTokenClient | null = null;
let clientAudience: string | null = null;

/**
 * Get (or create) an ID token client for the given audience.
 * The audience must be the origin of the target Cloud Run service
 * (e.g. "https://api-service-xxxxx.run.app"), not the full URL with path.
 */
async function getClient(targetUrl: string): Promise<IdTokenClient> {
  const audience = new URL(targetUrl).origin;

  if (!idTokenClient || clientAudience !== audience) {
    idTokenClient = await auth.getIdTokenClient(audience);
    clientAudience = audience;
  }

  return idTokenClient;
}

export async function sendParsedBooking(booking: Booking & { messageId: string }): Promise<unknown> {
  if (!config.PARENT_API_URL) {
    console.log('PARENT_API_URL not configured, skipping API forwarding');
    return null;
  }

  const client = await getClient(config.PARENT_API_URL);

  const response = await client.request({
    url: config.PARENT_API_URL,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: booking,
  });

  return response.data;
}
