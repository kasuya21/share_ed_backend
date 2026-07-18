import cron from 'node-cron';
import { prisma } from '../configs/prisma.js';

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
        select: { id: true }
      });

      if (postsToDelete.length > 0) {
        const postIds = postsToDelete.map(p => p.id);
        console.log(`[Cron] Found ${postIds.length} DELETED posts to permanently remove.`);

        for (const postId of postIds) {
          // Delete related records first to avoid foreign key constraints
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
          console.log(`[Cron] Permanently deleted post ${postId}`);
        }
      }
    } catch (error) {
      console.error('[Cron] Error during DELETED posts cleanup:', error);
    }
  });
};
