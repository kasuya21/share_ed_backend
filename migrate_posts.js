import { prisma } from './configs/prisma.js';

async function main() {
  const publishedCount = await prisma.post.updateMany({
    where: { post_status: "PUBLISHED" },
    data: { post_status: "ACTIVE" }
  });
  console.log("Updated PUBLISHED to ACTIVE:", publishedCount.count);

  const archivedCount = await prisma.post.updateMany({
    where: { post_status: "ARCHIVED" },
    data: { post_status: "DELETED" }
  });
  console.log("Updated ARCHIVED to DELETED:", archivedCount.count);
}

main().catch(console.error).finally(() => prisma.$disconnect());
