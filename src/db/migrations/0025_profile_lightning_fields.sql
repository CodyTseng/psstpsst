ALTER TABLE `profiles` ADD COLUMN `lud06` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD COLUMN `lud16` text;--> statement-breakpoint
UPDATE `profiles`
SET
  `lud06` = CASE
    WHEN json_type(json_extract(`raw_event`, '$.content'), '$.lud06') = 'text'
      THEN NULLIF(json_extract(json_extract(`raw_event`, '$.content'), '$.lud06'), '')
    ELSE NULL
  END,
  `lud16` = CASE
    WHEN json_type(json_extract(`raw_event`, '$.content'), '$.lud16') = 'text'
      THEN NULLIF(json_extract(json_extract(`raw_event`, '$.content'), '$.lud16'), '')
    ELSE NULL
  END
WHERE
  `raw_event` IS NOT NULL
  AND json_valid(`raw_event`)
  AND json_valid(json_extract(`raw_event`, '$.content'));
