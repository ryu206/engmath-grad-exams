import { assertAttachmentOwnerType, assertAttachmentUsageType } from '@/server/attachments/attachmentConstants';

export async function insertAttachment(connection, attachment) {
  assertAttachmentOwnerType(attachment.owner_type);
  assertAttachmentUsageType(attachment.usage_type);

  const [result] = await connection.execute(
    `INSERT INTO attachments (
      owner_type, owner_id, usage_type, disk, path, url, original_filename, stored_filename,
      mime_type, file_size, extension, width, height, checksum, display_order, alt_text, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      attachment.owner_type,
      attachment.owner_id,
      attachment.usage_type,
      attachment.disk,
      attachment.path,
      attachment.url,
      attachment.original_filename,
      attachment.stored_filename,
      attachment.mime_type,
      attachment.file_size,
      attachment.extension,
      attachment.width,
      attachment.height,
      attachment.checksum,
      attachment.display_order ?? 1,
      attachment.alt_text ?? null,
      attachment.metadata ? JSON.stringify(attachment.metadata) : null,
    ],
  );

  return result.insertId;
}

export async function findActiveAttachments(connection, ownerType, ownerId, usageType = null) {
  assertAttachmentOwnerType(ownerType);
  if (usageType) assertAttachmentUsageType(usageType);

  const params = [ownerType, ownerId];
  const usageSql = usageType ? 'AND usage_type = ?' : '';
  if (usageType) params.push(usageType);

  const [rows] = await connection.execute(
    `SELECT id, owner_type, owner_id, usage_type, disk, path, url, original_filename, stored_filename,
            mime_type, file_size, extension, width, height, checksum, display_order, alt_text, metadata
     FROM attachments
     WHERE owner_type = ? AND owner_id = ? ${usageSql} AND deleted_at IS NULL
     ORDER BY display_order, id`,
    params,
  );

  return rows;
}

export async function softDeleteAttachments(connection, ownerType, ownerId, usageType = null) {
  assertAttachmentOwnerType(ownerType);
  if (usageType) assertAttachmentUsageType(usageType);

  const params = [ownerType, ownerId];
  const usageSql = usageType ? 'AND usage_type = ?' : '';
  if (usageType) params.push(usageType);

  await connection.execute(
    `UPDATE attachments
     SET deleted_at = CURRENT_TIMESTAMP
     WHERE owner_type = ? AND owner_id = ? ${usageSql} AND deleted_at IS NULL`,
    params,
  );
}
