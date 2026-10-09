-- DropForeignKey
ALTER TABLE "LoginHistory" DROP CONSTRAINT "LoginHistory_userId_fkey";

-- DropIndex
DROP INDEX "LoginHistory_userId_idx";

-- CreateIndex
CREATE INDEX "LoginHistory_userId_loginTime_idx" ON "LoginHistory"("userId", "loginTime" DESC);

-- AddForeignKey
ALTER TABLE "LoginHistory" ADD CONSTRAINT "LoginHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
