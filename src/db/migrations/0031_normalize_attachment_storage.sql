CREATE TABLE `attachment_urls` (
	`url` text PRIMARY KEY NOT NULL,
	`ox` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_attachment_urls_ox` ON `attachment_urls` (`ox`);--> statement-breakpoint
CREATE TABLE `stored_files` (
	`ox` text PRIMARY KEY NOT NULL,
	`mime` text NOT NULL,
	`size` integer,
	`downloaded_at` integer NOT NULL
);--> statement-breakpoint
CREATE TABLE `message_media` (
	`account_pubkey` text NOT NULL,
	`message_id` text NOT NULL,
	`conversation_key` text NOT NULL,
	`url` text NOT NULL,
	`source` text NOT NULL,
	`media_kind` text NOT NULL,
	`gallery` integer NOT NULL,
	`created_at` integer NOT NULL,
	`order_at` integer NOT NULL,
	PRIMARY KEY(`account_pubkey`, `message_id`, `url`),
	FOREIGN KEY (`account_pubkey`,`message_id`) REFERENCES `messages`(`account_pubkey`,`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_msg_media_gallery_time` ON `message_media` (`account_pubkey`,`conversation_key`,`gallery`,`order_at`,`message_id`,`url`);--> statement-breakpoint
CREATE INDEX `idx_msg_media_source_url` ON `message_media` (`source`,`url`);--> statement-breakpoint
INSERT INTO `attachment_urls` (`url`, `ox`)
SELECT ma.`url`, max(ma.`ox`)
FROM `message_attachments` ma
INNER JOIN `messages` m ON m.`account_pubkey` = ma.`account_pubkey` AND m.`id` = ma.`message_id`
WHERE m.`kind` = 15 AND ma.`ox` IS NOT NULL
GROUP BY ma.`url`;--> statement-breakpoint
INSERT INTO `stored_files` (`ox`, `mime`, `size`, `downloaded_at`)
SELECT ma.`ox`, max(ma.`mime`), NULL, max(ma.`downloaded_at`)
FROM `message_attachments` ma
INNER JOIN `messages` m ON m.`account_pubkey` = ma.`account_pubkey` AND m.`id` = ma.`message_id`
WHERE m.`kind` = 15 AND ma.`ox` IS NOT NULL AND ma.`mime` IS NOT NULL AND ma.`downloaded_at` IS NOT NULL
GROUP BY ma.`ox`;--> statement-breakpoint
INSERT INTO `message_media` (`account_pubkey`, `message_id`, `conversation_key`, `url`, `source`, `media_kind`, `gallery`, `created_at`, `order_at`)
SELECT classified.`account_pubkey`, classified.`message_id`, classified.`conversation_key`, classified.`url`, classified.`source`, classified.`media_kind`, classified.`media_kind` IN ('image', 'video'), classified.`created_at`, classified.`order_at`
FROM (
	SELECT ma.`account_pubkey`, ma.`message_id`, ma.`conversation_key`, ma.`url`,
		CASE WHEN m.`kind` = 15 THEN 'attachment' ELSE 'embedded' END AS `source`,
		CASE
			WHEN EXISTS (
				SELECT 1 FROM json_each(m.`tags`) tag, json_each(tag.`value`) part
				WHERE (json_extract(tag.`value`, '$[0]') IN ('m', 'mime', 'file-type') AND json_extract(tag.`value`, '$[1]') LIKE 'audio/%')
					OR part.`value` LIKE 'm audio/%' OR part.`value` LIKE 'mime audio/%' OR part.`value` LIKE 'file-type audio/%'
			) OR lower(substr(ma.`url`, 1, instr(ma.`url` || '?', '?') - 1)) GLOB '*.aac'
				OR lower(substr(ma.`url`, 1, instr(ma.`url` || '?', '?') - 1)) GLOB '*.flac'
				OR lower(substr(ma.`url`, 1, instr(ma.`url` || '?', '?') - 1)) GLOB '*.m4a'
				OR lower(substr(ma.`url`, 1, instr(ma.`url` || '?', '?') - 1)) GLOB '*.mp3'
				OR lower(substr(ma.`url`, 1, instr(ma.`url` || '?', '?') - 1)) GLOB '*.oga'
				OR lower(substr(ma.`url`, 1, instr(ma.`url` || '?', '?') - 1)) GLOB '*.opus'
				OR lower(substr(ma.`url`, 1, instr(ma.`url` || '?', '?') - 1)) GLOB '*.wav'
				OR lower(substr(ma.`url`, 1, instr(ma.`url` || '?', '?') - 1)) GLOB '*.wma' THEN 'audio'
			WHEN EXISTS (
				SELECT 1 FROM json_each(m.`tags`) tag, json_each(tag.`value`) part
				WHERE (json_extract(tag.`value`, '$[0]') IN ('m', 'mime', 'file-type') AND json_extract(tag.`value`, '$[1]') LIKE 'image/%')
					OR part.`value` LIKE 'm image/%' OR part.`value` LIKE 'mime image/%' OR part.`value` LIKE 'file-type image/%'
			) THEN 'image'
			WHEN EXISTS (
				SELECT 1 FROM json_each(m.`tags`) tag, json_each(tag.`value`) part
				WHERE (json_extract(tag.`value`, '$[0]') IN ('m', 'mime', 'file-type') AND json_extract(tag.`value`, '$[1]') LIKE 'video/%')
					OR part.`value` LIKE 'm video/%' OR part.`value` LIKE 'mime video/%' OR part.`value` LIKE 'file-type video/%'
			) THEN 'video'
			WHEN lower(substr(ma.`url`, 1, instr(ma.`url` || '?', '?') - 1)) GLOB '*.jpg'
				OR lower(substr(ma.`url`, 1, instr(ma.`url` || '?', '?') - 1)) GLOB '*.jpeg'
				OR lower(substr(ma.`url`, 1, instr(ma.`url` || '?', '?') - 1)) GLOB '*.png'
				OR lower(substr(ma.`url`, 1, instr(ma.`url` || '?', '?') - 1)) GLOB '*.gif'
				OR lower(substr(ma.`url`, 1, instr(ma.`url` || '?', '?') - 1)) GLOB '*.webp'
				OR lower(substr(ma.`url`, 1, instr(ma.`url` || '?', '?') - 1)) GLOB '*.avif'
				OR lower(substr(ma.`url`, 1, instr(ma.`url` || '?', '?') - 1)) GLOB '*.heic'
				OR lower(substr(ma.`url`, 1, instr(ma.`url` || '?', '?') - 1)) GLOB '*.heif' THEN 'image'
			WHEN m.`kind` = 15 THEN 'file'
			ELSE 'video'
		END AS `media_kind`,
		ma.`created_at`, ma.`order_at`
	FROM `message_attachments` ma
	INNER JOIN `messages` m ON m.`account_pubkey` = ma.`account_pubkey` AND m.`id` = ma.`message_id`
) classified;--> statement-breakpoint
DROP TABLE `message_attachments`;
