const { Storage } = require('@google-cloud/storage');
const config = require('../config');

const storage = new Storage({ projectId: config.GCP_PROJECT_ID });
const bucket = storage.bucket(config.GCS_BUCKET);

/**
 * Strip the gs://bucket/ prefix to get the relative path within the bucket.
 */
function toRelativePath(storagePath) {
  const prefix = `gs://${config.GCS_BUCKET}/`;
  return storagePath.startsWith(prefix)
    ? storagePath.slice(prefix.length)
    : storagePath;
}

/**
 * Fetch the HTML body of an email from GCS.
 * @param {string} storagePath - e.g. "gs://raw-email-store/emails/{messageId}"
 * @returns {Promise<string>} HTML content
 */
async function fetchEmailHtml(storagePath) {
  const basePath = toRelativePath(storagePath);
  const filePath = `${basePath}/body.html`;
  const file = bucket.file(filePath);

  const [contents] = await file.download();
  return contents.toString('utf-8');
}

/**
 * Fetch an attachment from GCS as a Buffer.
 * @param {string} gcsUri - Full GCS URI, e.g. "gs://raw-email-store/emails/{messageId}/attachments/file.pdf"
 * @returns {Promise<Buffer>} File contents
 */
async function fetchAttachment(gcsUri) {
  const filePath = toRelativePath(gcsUri);
  const file = bucket.file(filePath);

  const [contents] = await file.download();
  return contents;
}

/**
 * Fetch all attachments for an email.
 * @param {string} storagePath - Base storage path for the email
 * @param {Array<{filename: string, contentType: string, gcsUri: string}>} attachmentsMeta
 * @returns {Promise<Array<{filename: string, contentType: string, buffer: Buffer}>>}
 */
async function fetchAttachments(storagePath, attachmentsMeta) {
  if (!attachmentsMeta || attachmentsMeta.length === 0) return [];

  const results = await Promise.all(
    attachmentsMeta.map(async (att) => {
      const buffer = await fetchAttachment(att.gcsUri);
      return {
        filename: att.filename,
        contentType: att.contentType,
        buffer,
      };
    })
  );

  return results;
}

module.exports = { fetchEmailHtml, fetchAttachment, fetchAttachments };
