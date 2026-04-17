import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import config from '../config';

function ensureInitialized(): void {
  if (getApps().length === 0) {
    initializeApp({
      credential: applicationDefault(),
      projectId: config.GCP_PROJECT_ID,
    });
  }
}

/**
 * Extract an email address from a "From" header value.
 * Handles formats like:
 *   - "Name <email@example.com>"
 *   - "email@example.com"
 *   - "<email@example.com>"
 */
export function extractEmailAddress(fromField: string): string | null {
  if (!fromField) return null;

  const bracketMatch = fromField.match(/<([^>]+@[^>]+)>/);
  if (bracketMatch) return bracketMatch[1].trim().toLowerCase();

  const plainMatch = fromField.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (plainMatch) return plainMatch[0].trim().toLowerCase();

  return null;
}

/**
 * Check whether a user with this email exists in Firebase Authentication.
 */
export async function isRegisteredUser(email: string): Promise<boolean> {
  ensureInitialized();

  try {
    await getAuth().getUserByEmail(email);
    return true;
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'auth/user-not-found') {
      return false;
    }
    throw err;
  }
}
