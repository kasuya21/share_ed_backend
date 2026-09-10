import { prisma } from "../configs/prisma.js";
import { createNotification } from "./notification.helper.js";

/**
 * Update achievement progress for a user based on type
 * @param {string} userId - User ID to update progress for
 * @param {string} achievementType - Achievement achievement_type (e.g., 'FOLLOWERS_COUNT', 'POST_LIKES')
 * @param {number} currentTotal - Current exact total value for the condition
 */
export const updateAchievementProgress = async (userId, achievementType, currentTotal) => {
  try {
    const achievements = await prisma.achievement.findMany({
      where: { achievement_type: achievementType }
    });

    for (const achievement of achievements) {
      let um = await prisma.userAchievement.findUnique({
        where: { user_id_achievement_id: { user_id: userId, achievement_id: achievement.id } }
      });

      if (!um) {
        um = await prisma.userAchievement.create({
          data: {
            user_id: userId,
            achievement_id: achievement.id,
            current_progress: 0,
            is_completed: false
          }
        });
      }

      if (um.is_completed) continue;

      const newProgress = Math.min(currentTotal, achievement.target_value);
      const isCompleted = newProgress >= achievement.target_value;

      await prisma.userAchievement.update({
        where: { id: um.id },
        data: {
          current_progress: newProgress,
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date() : null
        }
      });

      if (isCompleted) {
        await createNotification(
          userId,
          "QUEST_COMPLETED",
          `Congratulations! You've completed the achievement: ${achievement.title}`
        );
      }
    }
  } catch (error) {
    console.error(`Error updating achievement progress (${achievementType}):`, error);
  }
};

