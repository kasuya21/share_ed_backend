import "dotenv/config";
import { seedMilestonesAndRewards } from "file:///c:/Users/shiku/Desktop/share_ed_backend/utils/milestone.helper.js";
import { prisma } from "file:///c:/Users/shiku/Desktop/share_ed_backend/configs/prisma.js";

async function run() {
  console.log("Starting seeder test...");
  await seedMilestonesAndRewards();
  console.log("Verifying seeded Milestones in DB...");
  const milestones = await prisma.milestone.findMany({
    include: { reward_item: true }
  });
  console.log("Seeded Milestones:", JSON.stringify(milestones, null, 2));
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
