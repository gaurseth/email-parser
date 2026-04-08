const express = require('express');
const router = express.Router();
const { fetchEmailHtml, fetchAttachments } = require('../services/storage');
const { updateParsingStatus, getEmailMetadata } = require('../services/firestore');
const { identifyAndParse } = require('../parsers');
const { sendParsedBooking } = require('../services/api');

const TRANSIENT_CODES = new Set([4, 13, 14]); // gRPC: DEADLINE_EXCEEDED, INTERNAL, UNAVAILABLE
const TRANSIENT_NETWORK = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN']);

function isTransientError(err) {
  if (TRANSIENT_CODES.has(err.code)) return true;
  if (TRANSIENT_NETWORK.has(err.code)) return true;
  if (err.statusCode >= 500) return true;
  return false;
}

router.post('/', async (req, res) => {
  let messageId;

  try {
    const pubsubMessage = req.body.message;
    if (!pubsubMessage || !pubsubMessage.data) {
      return res.status(400).json({ error: 'Invalid Pub/Sub message' });
    }

    const data = JSON.parse(
      Buffer.from(pubsubMessage.data, 'base64').toString('utf-8')
    );

    messageId = data.messageId;
    const { from, subject, storagePath, attachmentCount } = data;

    console.log(`Processing email ${messageId} from ${from}: "${subject}"`);

    await updateParsingStatus(messageId, 'processing');

    // Fetch HTML body and attachments in parallel
    const emailMeta = attachmentCount > 0 ? await getEmailMetadata(messageId) : null;
    const [htmlBody, attachments] = await Promise.all([
      fetchEmailHtml(storagePath),
      emailMeta?.attachments?.length > 0
        ? fetchAttachments(storagePath, emailMeta.attachments)
        : Promise.resolve([]),
    ]);

    const result = await identifyAndParse(from, subject, htmlBody, attachments);

    if (result.status === 'skipped') {
      await updateParsingStatus(messageId, 'skipped', {
        skipReason: result.reason,
      });
      console.log(`Skipped ${messageId}: ${result.reason}`);
      return res.status(200).json({ status: 'skipped', messageId });
    }

    const booking = {
      messageId,
      ...result.booking,
      parserUsed: result.parserUsed,
      confidence: result.confidence,
      parsedAt: new Date().toISOString(),
    };

    await updateParsingStatus(messageId, 'parsed', {
      parserUsed: result.parserUsed,
      confidence: result.confidence,
      parsedBooking: booking,
    });

    await sendParsedBooking(booking);

    console.log(`Parsed ${messageId} with ${result.parserUsed} (${result.confidence} confidence)`);
    return res.status(200).json({ status: 'parsed', messageId });
  } catch (err) {
    if (isTransientError(err)) {
      console.error(`Transient error for ${messageId}:`, err.message);
      return res.status(500).json({ error: 'Transient failure, will retry' });
    }

    console.error(`Parse error for ${messageId}:`, err.message);
    if (messageId) {
      try {
        await updateParsingStatus(messageId, 'failed', {
          parsingError: err.message,
        });
      } catch (updateErr) {
        console.error(`Failed to update status for ${messageId}:`, updateErr.message);
      }
    }
    return res.status(200).json({ status: 'failed', messageId });
  }
});

module.exports = router;
