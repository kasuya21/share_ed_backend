import { prisma } from "../configs/prisma.js";

// ==========================================
// QUEST (ADMIN / GLOBAL SETTINGS)
// ==========================================

export const createQuest = async (req, res) => {
  try {
    const { quest_name, quest_type, target_value, reward_coin, is_daily } = req.body;

    if (!quest_name || !quest_type || target_value === undefined || reward_coin === undefined) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const quest = await prisma.quest.create({
      data: {
        quest_name,
        quest_type,
        target_value,
        reward_coin,
        is_daily: is_daily || false,
      },
    });

    res.status(201).json(quest);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getAllQuests = async (req, res) => {
  try {
    const quests = await prisma.quest.findMany();
    res.json(quests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const updateQuest = async (req, res) => {
  try {
    const { id } = req.params;
    const { quest_name, quest_type, target_value, reward_coin, is_daily } = req.body;

    const quest = await prisma.quest.update({
      where: { id },
      data: {
        quest_name,
        quest_type,
        target_value,
        reward_coin,
        is_daily,
      },
    });

    res.json(quest);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteQuest = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.quest.delete({ where: { id } });
    res.json({ message: "Quest deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ==========================================
// USER QUEST PROGRESS
// ==========================================

// Get all quest progress for the currently logged-in user
export const getUserQuests = async (req, res) => {
  try {
    const user_id = req.user.id;

    // Fetch all global quests and join with user progress
    const quests = await prisma.quest.findMany({
      include: {
        user_quests: {
          where: { user_id },
        },
      },
    });

    // Format response to be easier to consume by frontend
    const userQuests = quests.map((quest) => {
      const userProgress = quest.user_quests[0]; // will be undefined if no progress yet
      return {
        id: quest.id,
        quest_name: quest.quest_name,
        quest_type: quest.quest_type,
        target_value: quest.target_value,
        reward_coin: quest.reward_coin,
        is_daily: quest.is_daily,
        current_progress: userProgress ? userProgress.current_progress : 0,
        completed_at: userProgress ? userProgress.completed_at : null,
      };
    });

    res.json(userQuests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Update quest progress for the user
export const updateQuestProgress = async (req, res) => {
  try {
    const { quest_id, increment } = req.body;
    const user_id = req.user.id;
    const inc = increment || 1;

    // Get the quest details
    const quest = await prisma.quest.findUnique({ where: { id: quest_id } });
    if (!quest) {
      return res.status(404).json({ message: "Quest not found" });
    }

    // Upsert user quest progress
    const userQuest = await prisma.userQuest.upsert({
      where: {
        user_id_quest_id: { user_id, quest_id },
      },
      update: {
        current_progress: { increment: inc },
      },
      create: {
        user_id,
        quest_id,
        current_progress: inc,
      },
    });

    // Check if newly completed but not yet rewarded
    let newlyCompleted = false;
    if (userQuest.current_progress >= quest.target_value && !userQuest.completed_at) {
      newlyCompleted = true;
    }

    res.json({
      message: "Progress updated",
      userQuest,
      target_reached: userQuest.current_progress >= quest.target_value,
      can_claim_reward: newlyCompleted, // Frontend can show a "Claim Reward" button if this is true
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Claim reward for a completed quest
export const claimQuestReward = async (req, res) => {
  try {
    const { quest_id } = req.body;
    const user_id = req.user.id;

    // Use transaction to ensure data consistency (give coins + mark completed)
    const result = await prisma.$transaction(async (tx) => {
      // 1. Find UserQuest progress
      const userQuest = await tx.userQuest.findUnique({
        where: { user_id_quest_id: { user_id, quest_id } },
        include: { quest: true },
      });

      if (!userQuest) {
        throw new Error("You have not started this quest yet.");
      }

      if (userQuest.completed_at) {
        throw new Error("Reward has already been claimed for this quest.");
      }

      if (userQuest.current_progress < userQuest.quest.target_value) {
        throw new Error("Quest target has not been reached yet.");
      }

      // 2. Mark as completed
      const updatedUserQuest = await tx.userQuest.update({
        where: { id: userQuest.id },
        data: { completed_at: new Date() },
      });

      // 3. Give user reward coins
      const updatedUser = await tx.user.update({
        where: { id: user_id },
        data: { coin_balance: { increment: userQuest.quest.reward_coin } },
      });

      return { userQuest: updatedUserQuest, newCoinBalance: updatedUser.coin_balance };
    });

    res.json({
      message: "Reward claimed successfully!",
      ...result,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};
