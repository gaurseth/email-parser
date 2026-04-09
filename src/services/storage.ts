import { Storage } from '@google-cloud/storage';
import config from '../config';
import type { AttachmentMeta, Attachment } from '../types';

const storage = new Storage({ projectId: config.GCP_PROJECT_ID });
const bucket = storage.bucket(config.GCS_BUCKET);

function toRelativePath(storagePath: string): string {
  const prefix = `gs://${config.GCS_BUCKET}/`;
  return storagePath.startsWith(prefix)
    ? storagePath.slice(prefix.length)
    : storagePath;
}

export async function fetchEmailHtml(storagePath: string): Promise<string> {
  const basePath = toRelativePath(storagePath);
  const filePath = `${basePath}/body.html`;
  const file = bucket.file(filePath);

  const [contents] = await file.download();
  return contents.toString('utf-8');
}

export async function fetchAttachment(gcsUri: string): Promise<Buffer> {
  const filePath = toRelativePath(gcsUri);
  const file = bucket.file(filePath);

  const [contents] = await file.download();
  return contents;
}

export async function fetchAttachments(storagePath: string, attachmentsMeta: AttachmentMeta[]): Promise<Attachment[]> {
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
