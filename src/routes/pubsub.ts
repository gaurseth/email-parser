import { Router, Request, Response } from 'express';
import { fetchEmailHtml, fetchAttachments } from '../services/storage';
import { updateParsingStatus, getEmailMetadata } from '../services/firestore';
import { identifyAndParse } from '../parsers';
import { sendParsedBooking } from '../services/api';
import { extractEmailAddress, isRegisteredUser } from '../services/auth';
import type { PubSubMessageData } from '../types';

const router = Router();

const TRANSIENT_CODES = new Set([4, 13, 14]);
const TRANSIENT_NETWORK = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN']);

function isTransientError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  if (typeof e.code === 'number' && TRANSIENT_CODES.has(e.code)) return true;
  if (typeof e.code === 'string' && TRANSIENT_NETWORK.has(e.code)) return true;
  if (typeof e.statusCode === 'number' && e.statusCode >= 500) return true;
  return false;
}

router.post('/', async (req: Request, res: Response) => {
  let messageId: string | undefined;

  try {
    const pubsubMessage = req.body.message;
    if (!pubsubMessage || !pubsubMessage.data) {
      res.status(400).json({ error: 'Invalid Pub/Sub message' });
      return;
    }

    const data: PubSubMessageData = JSON.parse(
      Buffer.from(pubsubMessage.data, 'base64').toString('utf-8')
    );

    messageId = data.messageId;
    const { from, subject, storagePath } = data;

    console.log(`Processing email ${messageId} from ${from}: "${subject}"`);

    // Extract user email from the "from" field and verify the user is registered
    const userEmail = extractEmailAddress(from);
    if (!userEmail) {
      await updateParsingStatus(messageId, 'denied', {
        denyReason: 'Could not extract user email from From field',
        from,
      });
      console.warn(`Denied ${messageId}: could not extract email from "${from}"`);
      res.status(200).json({ status: 'denied', messageId });
      return;
    }

    const registered = await isRegisteredUser(userEmail);
    if (!registered) {
      await updateParsingStatus(messageId, 'denied', {
        denyReason: 'User not registered',
        userEmail,
      });
      console.warn(`Denied ${messageId}: user ${userEmail} not registered`);
      res.status(200).json({ status: 'denied', messageId, reason: 'user not registered' });
      return;
    }

    await updateParsingStatus(messageId, 'processing', { userEmail });

    const [emailMeta, htmlBody] = await Promise.all([
      getEmailMetadata(messageId),
      fetchEmailHtml(storagePath),
    ]);

    const attachments = emailMeta?.attachments?.length
      ? await fetchAttachments(storagePath, emailMeta.attachments)
      : [];

    console.log(`Email ${messageId}: ${attachments.length} attachment(s) fetched`);

    const result = await identifyAndParse(from, subject, htmlBody, attachments);

    if (result.status === 'skipped') {
      await updateParsingStatus(messageId, 'skipped', {
        skipReason: result.reason,
      });
      console.log(`Skipped ${messageId}: ${result.reason}`);
      res.status(200).json({ status: 'skipped', messageId });
      return;
    }

    // userEmail and messageId placed AFTER the spread so they can't be overridden
    const booking = {
      ...result.booking,
      messageId,
      userEmail,
      parserUsed: result.parserUsed,
      confidence: result.confidence,
      parsedAt: new Date().toISOString(),
    };

    await updateParsingStatus(messageId, 'parsed', {
      parserUsed: result.parserUsed,
      confidence: result.confidence,
      parsedBooking: booking,
    });

    console.log(`Forwarding ${messageId} to parent API. userEmail=${booking.userEmail}, keys=${Object.keys(booking).join(',')}`);

    await sendParsedBooking(booking);

    console.log(`Parsed ${messageId} for ${userEmail} with ${result.parserUsed} (${result.confidence} confidence)`);
    res.status(200).json({ status: 'parsed', messageId });
  } catch (err) {
    if (isTransientError(err)) {
      console.error(`Transient error for ${messageId}:`, (err as Error).message);
      res.status(500).json({ error: 'Transient failure, will retry' });
      return;
    }

    console.error(`Parse error for ${messageId}:`, (err as Error).message);
    if (messageId) {
      try {
        await updateParsingStatus(messageId, 'failed', {
          parsingError: (err as Error).message,
        });
      } catch (updateErr) {
        console.error(`Failed to update status for ${messageId}:`, (updateErr as Error).message);
      }
    }
    res.status(200).json({ status: 'failed', messageId });
  }
});

export default router;
