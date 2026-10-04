-- Repair legacy arrival/draft activity times with indexed last-message lookups.
UPDATE conversations
SET updated_at = CASE
      WHEN last_message_id IS NULL THEN created_at
      ELSE COALESCE(
        (SELECT created_at FROM messages
         WHERE messages.account_pubkey = conversations.account_pubkey
           AND messages.id = conversations.last_message_id),
        last_message_at, created_at)
    END,
    updated_order_at = CASE
      WHEN last_message_id IS NULL THEN created_order_at
      ELSE COALESCE(
        (SELECT order_at FROM messages
         WHERE messages.account_pubkey = conversations.account_pubkey
           AND messages.id = conversations.last_message_id),
        last_message_order_at, created_order_at)
    END;
