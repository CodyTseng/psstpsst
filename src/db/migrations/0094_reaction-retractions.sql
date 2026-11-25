CREATE INDEX idx_msg_reaction_retractions
  ON messages (account_pubkey, conversation_key, reply_to_id, sender_pubkey) WHERE kind = 5;
