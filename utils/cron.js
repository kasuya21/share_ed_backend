import cron from 'node-cron';
import { prisma } from '../configs/prisma.js';
import cloudinary from '../configs/cloudinary.config.js';
import { extractPublicId } from '../utils/cloudinary.helper.js';

export const initCronJobs = () => {
  // Run every hour
  cron.schedule('0 * * * *', async () => {
    try {
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
              await cloudinary.uploader.destroy(publicId).catch(err => console.error(`[Cron] Failed to delete cover for post ${postId}:`, err.message));
            }
          }

          // 2. Delete media files from Cloudinary
          for (const m of post.media) {
            const publicId = extractPublicId(m.media_url);
            if (publicId) {
              const resourceType = m.media_type === 'PDF' ? 'raw' : (m.media_type === 'VIDEO' ? 'video' : 'image');
              await cloudinary.uploader.destroy(publicId, { resource_type: resourceType })
                .catch(err => console.error(`[Cron] Failed to delete media for post ${postId}:`, err.message));
            }
          }

          // 3. Delete empty folders (optional cleanup, ignoring errors if folder not empty or not found)
          try {
            await cloudinary.api.delete_folder(`share-ed/posts/${postId}/pdfs`).catch(() => {});
            await cloudinary.api.delete_folder(`share-ed/posts/${postId}/media`).catch(() => {});
            await cloudinary.api.delete_folder(`share-ed/posts/${postId}`).catch(() => {});
          } catch (e) {
            // Ignore folder deletion errors
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
      console.error('[Cron] Error during DELETED posts cleanup:', error);
    }
  });
};
