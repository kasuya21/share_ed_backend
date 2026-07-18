import { prisma } from "../configs/prisma.js";
import { createNotification } from "./notification.helper.js";

/**
 * Update milestone progress for a user based on type
 * @param {string} userId - User ID to update progress for
 * @param {string} milestoneType - Milestone milestone_type (e.g., 'FOLLOWERS_COUNT', 'POST_LIKES')
 * @param {number} currentTotal - Current exact total value for the condition
 */
export const updateMilestoneProgress = async (userId, milestoneType, currentTotal) => {
  try {
    const milestones = await prisma.milestone.findMany({
      where: { milestone_type: milestoneType }
    });

    for (const milestone of milestones) {
      let um = await prisma.userMilestone.findUnique({
        where: { user_id_milestone_id: { user_id: userId, milestone_id: milestone.id } }
      });

      if (!um) {
        um = await prisma.userMilestone.create({
          data: {
            user_id: userId,
            milestone_id: milestone.id,
            current_progress: 0,
            is_completed: false
          }
        });
      }

      if (um.is_completed) continue;

      const newProgress = Math.min(currentTotal, milestone.target_value);
      const isCompleted = newProgress >= milestone.target_value;

      await prisma.userMilestone.update({
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
          `Congratulations! You've completed the milestone: ${milestone.title}`
        );
      }
    }
  } catch (error) {
    console.error(`Error updating milestone progress (${milestoneType}):`, error);
  }
};

/**
 * Seed required milestones and reward items if they do not exist
 */
export const seedMilestonesAndRewards = async () => {
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

    // 2. Seed Milestones
    await prisma.milestone.upsert({
      where: { id: "milestone_followers_10" },
      update: {},
      create: {
        id: "milestone_followers_10",
        title: "มีผู้ติดตามครบ 10 คนแล้ว",
        description: "เป้าหมายผู้ติดตามครบ 10 คน",
        target_value: 10,
        milestone_type: "FOLLOWERS_COUNT",
        reward_item_id: specialTheme.id
      }
    });

    await prisma.milestone.upsert({
      where: { id: "milestone_likes_50" },
      update: {},
      create: {
        id: "milestone_likes_50",
        title: "มีคนกดไลค์ให้ครบ 50 ไลค์แล้ว",
        description: "เป้าหมายยอดไลค์สะสมครบ 50 ไลค์",
        target_value: 50,
        milestone_type: "POST_LIKES",
        reward_item_id: specialFrame.id
      }
    });

    console.log("[Milestone Seeder] Milestones and Rewards seeded successfully.");
  } catch (error) {
    console.error("[Milestone Seeder] Seeding error:", error);
  }
};
