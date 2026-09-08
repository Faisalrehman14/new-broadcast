-- Production SaaS: plans, OTP, payment orders, user plan fields
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan_key" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan_expires_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "users_plan_key_idx" ON "users"("plan_key");

ALTER TABLE "user_quotas" ALTER COLUMN "credits_remaining" SET DEFAULT 2000;
ALTER TABLE "user_quotas" ALTER COLUMN "credits_monthly" SET DEFAULT 2000;

CREATE TABLE IF NOT EXISTS "email_otp_codes" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_otp_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "email_otp_codes_email_purpose_idx" ON "email_otp_codes"("email", "purpose");

CREATE TABLE IF NOT EXISTS "subscription_plans" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "message_limit" INTEGER NOT NULL,
    "interval" TEXT NOT NULL DEFAULT 'month',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_plans_key_key" ON "subscription_plans"("key");

CREATE TABLE IF NOT EXISTS "payment_orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_key" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'alby',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "bolt11" TEXT,
    "payment_hash" TEXT,
    "qr_data_url" TEXT,
    "sats" INTEGER,
    "expires_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "payment_orders_user_id_status_idx" ON "payment_orders"("user_id", "status");
CREATE INDEX IF NOT EXISTS "payment_orders_payment_hash_idx" ON "payment_orders"("payment_hash");
CREATE INDEX IF NOT EXISTS "payment_orders_status_created_at_idx" ON "payment_orders"("status", "created_at");

DO $$ BEGIN
  ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
