-- CreateTable
CREATE TABLE "SigningKey" (
    "id" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'ES256',
    "publicJwk" JSONB NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "SigningKey_pkey" PRIMARY KEY ("id")
);

