const { Storage } = require('@google-cloud/storage');
const config = require('../config');

const storage = new Storage({ projectId: config.GCP_PROJECT_ID });
const bucket = storage.bucket(config.GCS_BUCKET);

/**
 * Fetch the HTML body of an email from GCS.
 * @param {string} storagePath - e.g. "gs://raw-email-store/emails/{messageId}"
 * @returns {Promise<string>} HTML content
 */
async function fetchEmailHtml(storagePath) {
  // storagePath is like "gs://bucket/emails/{messageId}"
  // We need the path after the bucket name
  const prefix = `gs://${config.GCS_BUCKET}/`;
  const basePath = storagePath.startsWith(prefix)
    ? storagePath.slice(prefix.length)
    : storagePath;

  const filePath = `${basePath}/body.html`;
  const file = bucket.file(filePath);

  const [contents] = await file.download();
  return contents.toString('utf-8');
}

module.exports = { fetchEmailHtml };
