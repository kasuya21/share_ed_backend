import { prisma } from "../configs/prisma.js";

// GET /api/v1/achievements
export const getAchievements = async (req, res) => {
  try {
    const userId = req.user.id;

    const achievements = await prisma.achievement.findMany({
      include: {
        reward_item: true,
      }
    });

    const userAchievements = await prisma.userAchievement.findMany({
      where: { user_id: userId }
    });

    // Merge data so frontend sees achievements + progress and status
    const result = achievements.map(m => {
      const um = userAchievements.find(x => x.achievement_id === m.id);
      let status = "LOCKED";
      if (um) {
        if (um.claimed_at) {
          status = "CLAIMED";
        } else if (um.is_completed) {
          status = "READY_TO_CLAIM";
        }
      }
      return {
        ...m,
        current_progress: um ? um.current_progress : 0,
        is_completed: um ? um.is_completed : false,
        completed_at: um ? um.completed_at : null,
        claimed_at: um ? um.claimed_at : null,
        status
      };
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("Get achievements error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch achievements" });
  }
};

// POST /api/v1/achievements/:id/claim
export const claimAchievementReward = async (req, res) => {
  try {
    const userId = req.user.id;
    const achievementId = req.params.id;

    const um = await prisma.userAchievement.findUnique({
      where: { user_id_achievement_id: { user_id: userId, achievement_id: achievementId } },
      include: { achievement: true }
    });

    if (!um) {
      return res.status(404).json({ success: false, message: "Achievement progress not found" });
    }

    if (!um.is_completed) {
      return res.status(400).json({ success: false, message: "Achievement is not completed yet" });
    }

    if (um.claimed_at) {
      return res.status(400).json({ success: false, message: "Reward already claimed" });
    }

    // Grant reward if exists
    if (um.achievement.reward_item_id) {
      // Create userUnlockedItem
      const existingUnlock = await prisma.userUnlockedItem.findFirst({
        where: {
          user_id: userId,
          item_id: um.achievement.reward_item_id
        }
      });

      if (!existingUnlock) {
         await prisma.userUnlockedItem.create({
           data: {
             user_id: userId,
             item_id: um.achievement.reward_item_id
           }
         });
      }
    }

    const updated = await prisma.userAchievement.update({
      where: { id: um.id },
      data: { claimed_at: new Date() }
    });

    res.status(200).json({ success: true, message: "Reward claimed successfully", data: updated });
  } catch (error) {
    console.error("Claim achievement error:", error);
    res.status(500).json({ success: false, message: "Failed to claim reward" });
  }
};
