UPDATE messages
SET disappear_after_seconds = NULL, expires_at = NULL
WHERE (disappear_after_seconds IS NOT NULL OR expires_at IS NOT NULL)
  AND EXISTS (
    SELECT 1 FROM conversations
    WHERE conversations.account_pubkey = messages.account_pubkey
      AND conversations.conversation_key = messages.conversation_key
      AND conversations.group_id IS NOT NULL
  );
--> statement-breakpoint
UPDATE conversations
SET disappear_after_seconds = NULL
WHERE group_id IS NOT NULL AND disappear_after_seconds IS NOT NULL;
