import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * NotificationType records — ต้อง seed ก่อนใช้ระบบ notification
 * type_code ต้องตรงกับที่เรียกใน createNotification()
 */
const notificationTypes = [
  { type_code: "NEW_FOLLOWER",  description: "Someone followed you" },
  { type_code: "NEW_LIKE",      description: "Someone liked your post" },
  { type_code: "NEW_COMMENT",   description: "Someone commented on your post" },
  { type_code: "NEW_POST",      description: "Someone you follow published a new post" },
  { type_code: "POST_SUSPENDED",description: "Your post has been suspended" },
  { type_code: "POST_RESTORED", description: "Your post has been restored by a moderator" },
  { type_code: "POST_REMOVED",  description: "Your post has been removed by a moderator" },
  { type_code: "POST_REPORTED", description: "A post has been auto-suspended (moderator alert)" },
  { type_code: "QUEST_COMPLETED", description: "You have completed a quest" },
];

async function main() {
  console.log("🌱 Seeding NotificationTypes...");

  for (const nt of notificationTypes) {
    await prisma.notificationType.upsert({
      where: { type_code: nt.type_code },
      update: { description: nt.description },
      create: nt,
    });
    console.log(`  ✅ ${nt.type_code}`);
  }

  console.log("✨ Seed complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
