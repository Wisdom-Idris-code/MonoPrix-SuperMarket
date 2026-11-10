ALTER TABLE "Payment" ADD COLUMN "providerSessionId" TEXT;

CREATE UNIQUE INDEX "Payment_providerSessionId_key" ON "Payment"("providerSessionId");
