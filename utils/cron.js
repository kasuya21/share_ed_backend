import cron from 'node-cron';
import { prisma } from '../configs/prisma.js';
import cloudinary from '../configs/cloudinary.config.js';
import { extractPublicId } from '../utils/cloudinary.helper.js';
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
  // Run every hour
  cron.schedule('0 * * * *', async () => {
    try {
      await cleanupExpiredUploadSessions();
      console.log('[Cron] Running cleanup for DELETED posts...');
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

      // Find posts that were marked as DELETED and haven't been updated in 3 hours
      const postsToDelete = await prisma.post.findMany({
        where: {
          post_status: 'DELETED',
          updated_at: {
            lte: threeHoursAgo
          }
        },
        select: { 
          id: true,
          cover_image: true,
          media: {
            select: {
              media_url: true,
              media_type: true
            }
          }
        }
      });

      if (postsToDelete.length > 0) {
        console.log(`[Cron] Found ${postsToDelete.length} DELETED posts to permanently remove.`);

        for (const post of postsToDelete) {
          const postId = post.id;

          // 1. Delete cover image from Cloudinary
          if (post.cover_image) {
            const publicId = extractPublicId(post.cover_image);
            if (publicId) {
              await cloudinary.uploader.destroy(publicId).catch(err => logWarn('cron.cover.delete_failed', err, undefined, { postId }));
            }
          }

          // 2. Delete media files from Cloudinary
          for (const m of post.media) {
            const publicId = extractPublicId(m.media_url);
            if (publicId) {
              const resourceType = m.media_type === 'PDF' ? 'raw' : (m.media_type === 'VIDEO' ? 'video' : 'image');
              await cloudinary.uploader.destroy(publicId, { resource_type: resourceType })
                .catch(err => logWarn('cron.media.delete_failed', err, undefined, { postId }));
            }
          }

          // 3. Delete empty folders (optional cleanup, ignoring errors if folder not empty or not found)
          try {
            await cloudinary.api.delete_folder(`share-ed/posts/${postId}/pdfs`).catch(error => logWarn('cron.folder.delete_failed', error, undefined, { postId, folderType: 'pdfs' }));
            await cloudinary.api.delete_folder(`share-ed/posts/${postId}/media`).catch(error => logWarn('cron.folder.delete_failed', error, undefined, { postId, folderType: 'media' }));
            await cloudinary.api.delete_folder(`share-ed/posts/${postId}`).catch(error => logWarn('cron.folder.delete_failed', error, undefined, { postId, folderType: 'post' }));
          } catch (e) {
            logWarn('cron.folder.cleanup_failed', e, undefined, { postId });
          }

          // 4. Delete related records first to avoid foreign key constraints
          await prisma.$transaction([
            prisma.comment.deleteMany({ where: { post_id: postId } }),
            prisma.like.deleteMany({ where: { post_id: postId } }),
            prisma.bookmark.deleteMany({ where: { post_id: postId } }),
            prisma.postTag.deleteMany({ where: { post_id: postId } }),
            prisma.postMedia.deleteMany({ where: { post_id: postId } }),
            prisma.postView.deleteMany({ where: { post_id: postId } }),
            prisma.report.deleteMany({ where: { post_id: postId } }),
            prisma.post.delete({ where: { id: postId } })
          ]);
          console.log(`[Cron] Permanently deleted post ${postId} and its media`);
        }
      }
    } catch (error) {
      logError('cron.deleted_posts.cleanup_failed', error);
    }
  }, { noOverlap: true });
};
