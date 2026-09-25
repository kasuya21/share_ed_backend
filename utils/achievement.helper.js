import { prisma } from "../configs/prisma.js";
import { createNotification } from "./notification.helper.js";
import { logError } from "./logger.js";

export const SUPPORTED_ACHIEVEMENT_TYPES = Object.freeze([
  "POSTS_CREATED",
  "COMMENTS_CREATED",
  "FOLLOWERS_COUNT",
  "POST_LIKES",
  "LIKES_GIVEN",
]);

async function getAchievementsByType(achievementType) {
  return prisma.achievement.findMany({
    where: { achievement_type: achievementType }
  });
}

/**
 * Update achievement progress for a user based on type
 * @param {string} userId - User ID to update progress for
 * @param {string} achievementType - Achievement achievement_type (e.g., 'FOLLOWERS_COUNT', 'POST_LIKES')
 * @param {number} currentTotal - Current exact total value for the condition
 */
export const updateAchievementProgress = async (userId, achievementType, currentTotal) => {
  try {
    if (!userId || !SUPPORTED_ACHIEVEMENT_TYPES.includes(achievementType)) return;

    const normalizedTotal = Math.max(0, Math.trunc(Number(currentTotal) || 0));
    const achievements = await getAchievementsByType(achievementType);
    if (achievements.length === 0) return;

    await prisma.userAchievement.createMany({
      data: achievements.map((achievement) => ({
          user_id: userId,
          achievement_id: achievement.id,
          current_progress: 0,
          is_completed: false,
      })),
      skipDuplicates: true,
    });

    const transitions = await Promise.all(achievements.map(async (achievement) => {
      const newProgress = Math.min(normalizedTotal, achievement.target_value);
      const isCompleted = newProgress >= achievement.target_value;

      const updated = await prisma.userAchievement.updateMany({
        where: {
          user_id: userId,
          achievement_id: achievement.id,
          is_completed: false,
        },
        data: {
          current_progress: newProgress,
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date() : null
        }
      });

      return { achievement, becameCompleted: isCompleted && updated.count === 1 };
    }));

    await Promise.all(transitions.map(async ({ achievement, becameCompleted }) => {
      if (becameCompleted) {
        await createNotification(
          userId,
          "ACHIEVEMENT_COMPLETED",
          `Congratulations! You've completed the achievement: ${achievement.title}`
        );
      }
    }));
  } catch (error) {
    logError("achievement.progress_failed", error, undefined, { subjectId: userId, achievementType });
  }
};
