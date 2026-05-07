import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertAttachmentOwnerType } from '@/server/attachments/attachmentConstants';

export const MAX_IMAGE_SIZE = 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

export function validateImageFile(file, label = 'image') {
  if (!file) return null;
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return `${label} only accepts jpg, png, or webp`;
  if (file.size > MAX_IMAGE_SIZE) return `${label} must be 1MB or smaller`;
  return null;
}

export async function storeLocalImage(file, ownerType, ownerId) {
  assertAttachmentOwnerType(ownerType);

  const extension = ALLOWED_IMAGE_TYPES.get(file.type);
  const storedFilename = `${randomUUID()}.${extension}`;
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const relativeDir = `uploads/${ownerType}s/${year}/${month}/${ownerId}`;
  const absoluteDir = path.join(process.cwd(), 'public', relativeDir);
  await mkdir(absoluteDir, { recursive: true });

  const bytes = Buffer.from(await file.arrayBuffer());
  const absolutePath = path.join(absoluteDir, storedFilename);
  await writeFile(absolutePath, bytes);

  return {
    absolutePath,
    attachment: {
      disk: 'local',
      path: `${relativeDir}/${storedFilename}`.replaceAll('\\', '/'),
      url: null,
      original_filename: file.name || storedFilename,
      stored_filename: storedFilename,
      mime_type: file.type,
      file_size: file.size,
      extension,
      width: null,
      height: null,
      checksum: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

export async function deleteStoredFiles(absolutePaths) {
  await Promise.all(absolutePaths.map((absolutePath) => unlink(absolutePath).catch(() => {})));
}
