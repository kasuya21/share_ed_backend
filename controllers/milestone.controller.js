import { prisma } from "../configs/prisma.js";

// GET /api/v1/milestones
export const getMilestones = async (req, res) => {
  try {
    const userId = req.user.id;

    const milestones = await prisma.milestone.findMany({
      include: {
        reward_item: true,
      }
    });

    const userMilestones = await prisma.userMilestone.findMany({
      where: { user_id: userId }
    });

    // Merge data so frontend sees milestones + progress and status
    const result = milestones.map(m => {
      const um = userMilestones.find(x => x.milestone_id === m.id);
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
    console.error("Get milestones error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch milestones" });
  }
};

// POST /api/v1/milestones/:id/claim
export const claimMilestoneReward = async (req, res) => {
  try {
    const userId = req.user.id;
    const milestoneId = req.params.id;

    const um = await prisma.userMilestone.findUnique({
      where: { user_id_milestone_id: { user_id: userId, milestone_id: milestoneId } },
      include: { milestone: true }
    });

    if (!um) {
      return res.status(404).json({ success: false, message: "Milestone progress not found" });
    }

    if (!um.is_completed) {
      return res.status(400).json({ success: false, message: "Milestone is not completed yet" });
    }

    if (um.claimed_at) {
      return res.status(400).json({ success: false, message: "Reward already claimed" });
    }

    // Grant reward if exists
    if (um.milestone.reward_item_id) {
      // Create userUnlockedItem
      const existingUnlock = await prisma.userUnlockedItem.findFirst({
        where: {
          user_id: userId,
          item_id: um.milestone.reward_item_id
        }
      });

      if (!existingUnlock) {
         await prisma.userUnlockedItem.create({
           data: {
             user_id: userId,
             item_id: um.milestone.reward_item_id
           }
         });
      }
    }

    const updated = await prisma.userMilestone.update({
      where: { id: um.id },
      data: { claimed_at: new Date() }
    });

    res.status(200).json({ success: true, message: "Reward claimed successfully", data: updated });
  } catch (error) {
    console.error("Claim milestone error:", error);
    res.status(500).json({ success: false, message: "Failed to claim reward" });
  }
};
