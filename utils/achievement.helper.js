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

/**
 * Seed required achievements and reward items if they do not exist
 */
export const seedAchievementsAndRewards = async () => {
  try {
    // 1. Seed Reward Items
    const specialTheme = await prisma.rewardItem.upsert({
      where: { id: "theme_special_1" },
      update: {},
      create: {
        id: "theme_special_1",
        item_name: "ธีมโปรไฟล์พิเศษ",
        item_type: "THEME",
        image_url: "https://example.com/special_theme.png"
      }
    });

    const specialFrame = await prisma.rewardItem.upsert({
      where: { id: "frame_special_1" },
      update: {},
      create: {
        id: "frame_special_1",
        item_name: "กรอบรูปโปรไฟล์พิเศษ",
        item_type: "FRAME",
        image_url: "https://example.com/special_frame.png"
      }
    });

    // 2. Seed Achievements
    await prisma.achievement.upsert({
      where: { id: "achievement_followers_10" },
      update: {},
      create: {
        id: "achievement_followers_10",
        title: "มีผู้ติดตามครบ 10 คนแล้ว",
        description: "เป้าหมายผู้ติดตามครบ 10 คน",
        target_value: 10,
        achievement_type: "FOLLOWERS_COUNT",
        reward_item_id: specialTheme.id
      }
    });

    await prisma.achievement.upsert({
      where: { id: "achievement_likes_50" },
      update: {},
      create: {
        id: "achievement_likes_50",
        title: "มีคนกดไลค์ให้ครบ 50 ไลค์แล้ว",
        description: "เป้าหมายยอดไลค์สะสมครบ 50 ไลค์",
        target_value: 50,
        achievement_type: "POST_LIKES",
        reward_item_id: specialFrame.id
      }
    });

    console.log("[Achievement Seeder] Achievements and Rewards seeded successfully.");
  } catch (error) {
    console.error("[Achievement Seeder] Seeding error:", error);
  }
};
