import { Firestore, Timestamp } from '@google-cloud/firestore';
import config from '../config';
import type { EmailMetadata } from '../types';

const db = new Firestore({ projectId: config.GCP_PROJECT_ID });
const emailsCollection = db.collection('emails');

export async function updateParsingStatus(
  messageId: string,
  status: string,
  extraFields: Record<string, unknown> = {},
): Promise<void> {
  const updateData: Record<string, unknown> = {
    parsingStatus: status,
    ...(status === 'processing'
      ? { parsingStartedAt: Timestamp.now() }
      : { parsedAt: Timestamp.now() }),
    ...extraFields,
  };

  await emailsCollection.doc(messageId).update(updateData);
}

export async function getEmailMetadata(messageId: string): Promise<EmailMetadata> {
  const doc = await emailsCollection.doc(messageId).get();
  if (!doc.exists) {
    throw new Error(`Email document not found: ${messageId}`);
  }
  return doc.data() as EmailMetadata;
}
