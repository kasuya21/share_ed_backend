import { prisma } from "../configs/prisma.js";
import { createNotification } from "./notification.helper.js";
import { logError } from "./logger.js";

// In-Memory Cache for achievement definitions (5 minutes TTL)
const achievementTypeCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getAchievementsByType(achievementType) {
  if (process.env.NODE_ENV !== "test") {
    const cached = achievementTypeCache.get(achievementType);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      return cached.data;
    }
  }
  const data = await prisma.achievement.findMany({
    where: { achievement_type: achievementType }
  });
  if (process.env.NODE_ENV !== "test") {
    achievementTypeCache.set(achievementType, { data, timestamp: Date.now() });
  }
  return data;
}

/**
 * Update achievement progress for a user based on type
 * @param {string} userId - User ID to update progress for
 * @param {string} achievementType - Achievement achievement_type (e.g., 'FOLLOWERS_COUNT', 'POST_LIKES')
 * @param {number} currentTotal - Current exact total value for the condition
 */
export const updateAchievementProgress = async (userId, achievementType, currentTotal) => {
  try {
    const achievements = await getAchievementsByType(achievementType);

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
    logError("achievement.progress_failed", error, undefined, { subjectId: userId, achievementType });
  }
};

/**
 * Increment achievement progress by an amount without scanning or recounting historical tables
 * @param {string} userId - User ID to update progress for
 * @param {string} achievementType - Achievement achievement_type (e.g., 'POST_LIKES')
 * @param {number} amount - Amount to add to current progress (default: 1)
 */
export const incrementAchievementProgress = async (userId, achievementType, amount = 1) => {
  try {
    const achievements = await getAchievementsByType(achievementType);

    if (!achievements.length) return;

    for (const achievement of achievements) {
      let um = await prisma.userAchievement.findUnique({
        where: { user_id_achievement_id: { user_id: userId, achievement_id: achievement.id } }
      });

      if (um?.is_completed) continue;

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

      const newProgress = Math.min(um.current_progress + amount, achievement.target_value);
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
    logError("achievement.increment_failed", error, undefined, { subjectId: userId, achievementType });
  }
};
