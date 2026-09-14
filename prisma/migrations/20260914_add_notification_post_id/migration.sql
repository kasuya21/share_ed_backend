-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "post_id" TEXT;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE SET NULL ON UPDATE CASCADE;
