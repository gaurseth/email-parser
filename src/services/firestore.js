const { Firestore } = require('@google-cloud/firestore');
const config = require('../config');

const db = new Firestore({ projectId: config.GCP_PROJECT_ID });
const emailsCollection = db.collection('emails');

/**
 * Update the parsing status of an email document.
 * Merges with the existing doc created by the webhook service.
 */
async function updateParsingStatus(messageId, status, extraFields = {}) {
  const updateData = {
    parsingStatus: status,
    ...(status === 'processing'
      ? { parsingStartedAt: Firestore.Timestamp.now() }
      : { parsedAt: Firestore.Timestamp.now() }),
    ...extraFields,
  };

  await emailsCollection.doc(messageId).update(updateData);
}

/**
 * Get email metadata from Firestore.
 */
async function getEmailMetadata(messageId) {
  const doc = await emailsCollection.doc(messageId).get();
  if (!doc.exists) {
    throw new Error(`Email document not found: ${messageId}`);
  }
  return doc.data();
}

module.exports = { updateParsingStatus, getEmailMetadata };
