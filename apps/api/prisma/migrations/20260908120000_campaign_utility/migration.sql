-- AlterTable
ALTER TABLE "facebook_accounts" ADD COLUMN IF NOT EXISTS "oauth_fresh_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "broadcast_send" BOOLEAN NOT NULL DEFAULT true;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CampaignPhase" AS ENUM ('queued', 'setting_up_templates', 'syncing_leads', 'sending', 'completed', 'paused', 'stopped', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CampaignPageStatus" AS ENUM ('ok', 'no_token', 'skipped', 'error');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "broadcast_campaigns" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "phase" "CampaignPhase" NOT NULL DEFAULT 'queued',
    "message" TEXT,
    "image_url" TEXT,
    "attachment_id" TEXT,
    "speed_preset" TEXT NOT NULL DEFAULT 'safe',
    "delay_ms" INTEGER NOT NULL DEFAULT 500,
    "delivery_mode" TEXT NOT NULL DEFAULT 'freeform_plain',
    "utility_template" JSONB,
    "outside24h_image_mode" BOOLEAN NOT NULL DEFAULT false,
    "estimated_recipients" INTEGER NOT NULL DEFAULT 0,
    "estimated_quota" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "queued_count" INTEGER NOT NULL DEFAULT 0,
    "phase_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "broadcast_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "broadcast_campaign_pages" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "platform_page_id" TEXT NOT NULL,
    "page_name" TEXT NOT NULL,
    "encrypted_page_token" TEXT,
    "status" "CampaignPageStatus" NOT NULL DEFAULT 'ok',
    "template_ready" BOOLEAN NOT NULL DEFAULT false,
    "utility_template_name" TEXT,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "broadcast_campaign_pages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "broadcast_campaign_recipients" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "campaign_page_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "psid" TEXT NOT NULL,
    "name" TEXT,
    "last_interaction_at" TIMESTAMP(3),
    "status" "RecipientDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT NOT NULL,
    "failure_reason" TEXT,
    "external_message_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "broadcast_campaign_recipients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "broadcast_campaign_failures" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "page_id" TEXT,
    "psid" TEXT,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "broadcast_campaign_failures_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "page_utility_templates" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "template_name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en_US',
    "external_id" TEXT,
    "status" "TemplateApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "body" TEXT,
    "category" TEXT NOT NULL DEFAULT 'UTILITY',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "page_utility_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "user_quotas" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credits_remaining" INTEGER NOT NULL DEFAULT 5000,
    "credits_monthly" INTEGER NOT NULL DEFAULT 5000,
    "reset_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_quotas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "broadcast_template_drafts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "image_url" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "broadcast_template_drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "scheduled_broadcasts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "campaign_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scheduled_broadcasts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "broadcast_campaign_pages_campaign_id_page_id_key" ON "broadcast_campaign_pages"("campaign_id", "page_id");
CREATE INDEX IF NOT EXISTS "broadcast_campaigns_user_id_phase_idx" ON "broadcast_campaigns"("user_id", "phase");
CREATE INDEX IF NOT EXISTS "broadcast_campaigns_user_id_created_at_idx" ON "broadcast_campaigns"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "broadcast_campaign_pages_campaign_id_idx" ON "broadcast_campaign_pages"("campaign_id");
CREATE UNIQUE INDEX IF NOT EXISTS "broadcast_campaign_recipients_idempotency_key_key" ON "broadcast_campaign_recipients"("idempotency_key");
CREATE INDEX IF NOT EXISTS "broadcast_campaign_recipients_campaign_id_status_idx" ON "broadcast_campaign_recipients"("campaign_id", "status");
CREATE INDEX IF NOT EXISTS "broadcast_campaign_recipients_campaign_page_id_status_idx" ON "broadcast_campaign_recipients"("campaign_page_id", "status");
CREATE INDEX IF NOT EXISTS "broadcast_campaign_failures_campaign_id_created_at_idx" ON "broadcast_campaign_failures"("campaign_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "page_utility_templates_page_id_template_name_language_key" ON "page_utility_templates"("page_id", "template_name", "language");
CREATE INDEX IF NOT EXISTS "page_utility_templates_page_id_status_idx" ON "page_utility_templates"("page_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "user_quotas_user_id_key" ON "user_quotas"("user_id");
CREATE INDEX IF NOT EXISTS "broadcast_template_drafts_user_id_idx" ON "broadcast_template_drafts"("user_id");
CREATE INDEX IF NOT EXISTS "scheduled_broadcasts_user_id_scheduled_at_idx" ON "scheduled_broadcasts"("user_id", "scheduled_at");

DO $$ BEGIN
  ALTER TABLE "broadcast_campaigns" ADD CONSTRAINT "broadcast_campaigns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "broadcast_campaign_pages" ADD CONSTRAINT "broadcast_campaign_pages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "broadcast_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "broadcast_campaign_pages" ADD CONSTRAINT "broadcast_campaign_pages_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "facebook_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "broadcast_campaign_recipients" ADD CONSTRAINT "broadcast_campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "broadcast_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "broadcast_campaign_recipients" ADD CONSTRAINT "broadcast_campaign_recipients_campaign_page_id_fkey" FOREIGN KEY ("campaign_page_id") REFERENCES "broadcast_campaign_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "broadcast_campaign_failures" ADD CONSTRAINT "broadcast_campaign_failures_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "broadcast_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "page_utility_templates" ADD CONSTRAINT "page_utility_templates_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "facebook_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "user_quotas" ADD CONSTRAINT "user_quotas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "broadcast_template_drafts" ADD CONSTRAINT "broadcast_template_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "scheduled_broadcasts" ADD CONSTRAINT "scheduled_broadcasts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
