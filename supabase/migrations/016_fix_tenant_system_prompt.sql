-- Fix incorrect system_prompt for demo tenant that had Power BI content
-- Also adds greeting_message column to ai_config if not present
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS greeting_message TEXT;

UPDATE ai_config
SET system_prompt = 'তুমি একটি FMCG মুদি দোকানের AI assistant। গ্রাহকদের পণ্য দেখাও, অর্ডার নাও এবং সাহায্য করো। পণ্য তালিকা সবসময় products database থেকে দেখাও।'
WHERE tenant_id = 'c951f683-4332-4f5a-aa0a-040e8740e8d4'
  AND (system_prompt ILIKE '%power bi%' OR system_prompt ILIKE '%powerbi%' OR system_prompt IS NULL);
