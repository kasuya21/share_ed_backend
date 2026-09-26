import cron from 'node-cron';
import { prisma } from '../configs/prisma.js';
import cloudinary from '../configs/cloudinary.config.js';
import { cleanupSupabaseUploadSession } from './supabase-storage.js';
import { logError, logWarn } from './logger.js';

import { handleCleanupUploadSession } from '../workers/handlers.js';
import { enqueueJob, JOB_TYPES } from './job-queue.js';
import { UPLOAD_WORKSPACE_LIMITS } from '../configs/upload-workspace.constants.js';

const UPLOAD_SESSION_BATCH_SIZE = 50;

/**
 * Stage 1: Transition inactive OPEN sessions (no activity for 2 hours and past expires_at) to EXPIRED
 */
async function expireInactiveUploadSessions() {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - UPLOAD_WORKSPACE_LIMITS.SESSION_TTL_MS);

  const expiredSessions = await prisma.uploadSession.findMany({
    where: {
      status: { in: ['OPEN', 'PENDING'] },
      expires_at: { lte: now },
      last_activity_at: { lte: twoHoursAgo },
      post_id: null,
    },
    select: { id: true },
    take: UPLOAD_SESSION_BATCH_SIZE,
    orderBy: { expires_at: 'asc' },
  });

  if (expiredSessions.length > 0) {
    const sessionIds = expiredSessions.map(s => s.id);
    await prisma.uploadSession.updateMany({
      where: {
        id: { in: sessionIds },
        status: { in: ['OPEN', 'PENDING'] },
        post_id: null,
      },
      data: {
        status: 'EXPIRED',
        updated_at: now,
      },
    });
  }
}

/**
 * Stage 2: Enqueue cleanup for EXPIRED sessions that have exceeded the 24-hour grace period
 */
async function processExpiredSessionsPastGracePeriod() {
  const gracePeriodThreshold = new Date(Date.now() - UPLOAD_WORKSPACE_LIMITS.CLEANUP_GRACE_PERIOD_MS);

  const sessionsToClean = await prisma.uploadSession.findMany({
    where: {
      status: 'EXPIRED',
      updated_at: { lte: gracePeriodThreshold },
      post_id: null,
    },
    take: UPLOAD_SESSION_BATCH_SIZE,
    orderBy: { expires_at: 'asc' },
    select: { id: true, user_id: true },
  });

  for (const session of sessionsToClean) {
    try {
      // Enqueue as background job or execute via handler
      await enqueueJob(JOB_TYPES.CLEANUP_UPLOAD_SESSION, {
        uploadSessionId: session.id,
      });
    } catch (error) {
      logWarn('cron.upload_session.enqueue_cleanup_failed', error, undefined, {
        uploadSessionId: session.id,
      });
    }
  }

  // Delete tombstoned CLEANED records older than 7 days to keep table compact
  await prisma.uploadSession.deleteMany({
    where: {
      status: 'CLEANED',
      updated_at: { lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
  });
}

export const initCronJobs = () => {
  cron.schedule('0 * * * *', async () => {
    try {
      await expireInactiveUploadSessions();
      await processExpiredSessionsPastGracePeriod();
    } catch (error) {
      logError('cron.upload_sessions.lifecycle_failed', error);
    }
  }, { noOverlap: true });
};

