import cron from 'node-cron';
import { prisma } from '../configs/prisma.js';
import cloudinary from '../configs/cloudinary.config.js';
import { logError, logWarn } from './logger.js';

const UPLOAD_SESSION_BATCH_SIZE = 50;

async function cleanupExpiredUploadSessions() {
  const sessions = await prisma.uploadSession.findMany({
    where: {
      status: 'PENDING',
      expires_at: { lte: new Date() },
    },
    orderBy: { expires_at: 'asc' },
    take: UPLOAD_SESSION_BATCH_SIZE,
    select: { id: true, user_id: true },
  });

  for (const session of sessions) {
    const prefix = `share-ed/users/${session.user_id}/upload-sessions/${session.id}`;
    try {
      await Promise.all([
        cloudinary.api.delete_resources_by_prefix(prefix, { resource_type: 'image', type: 'upload' }),
        cloudinary.api.delete_resources_by_prefix(prefix, { resource_type: 'raw', type: 'upload' }),
      ]);

      for (const folder of ['covers', 'media', 'content', 'pdfs']) {
        await cloudinary.api.delete_folder(`${prefix}/${folder}`).catch(error =>
          logWarn('cron.upload_session.folder_delete_failed', error, undefined, {
            uploadSessionId: session.id,
            folder,
          })
        );
      }
      await cloudinary.api.delete_folder(prefix).catch(error =>
        logWarn('cron.upload_session.folder_delete_failed', error, undefined, {
          uploadSessionId: session.id,
          folder: 'root',
        })
      );

      await prisma.uploadSession.updateMany({
        where: { id: session.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
    } catch (error) {
      logWarn('cron.upload_session.cleanup_failed', error, undefined, {
        uploadSessionId: session.id,
      });
    }
  }

  await prisma.uploadSession.deleteMany({
    where: {
      status: 'EXPIRED',
      updated_at: { lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
  });
}

export const initCronJobs = () => {
  cron.schedule('0 * * * *', async () => {
    try {
      await cleanupExpiredUploadSessions();
    } catch (error) {
      logError('cron.upload_sessions.cleanup_failed', error);
    }
  }, { noOverlap: true });

};
