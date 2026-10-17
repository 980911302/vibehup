CREATE TABLE "mcp_event_subscriptions" (
    "id" TEXT NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "arguments" TEXT NOT NULL,
    "callback_url" TEXT NOT NULL,
    "secret_cipher" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_event_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mcp_event_subscriptions_event_name_expires_at_idx"
    ON "mcp_event_subscriptions"("event_name", "expires_at");
CREATE INDEX "mcp_event_subscriptions_api_key_id_idx"
    ON "mcp_event_subscriptions"("api_key_id");

ALTER TABLE "mcp_event_subscriptions"
    ADD CONSTRAINT "mcp_event_subscriptions_api_key_id_fkey"
    FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
