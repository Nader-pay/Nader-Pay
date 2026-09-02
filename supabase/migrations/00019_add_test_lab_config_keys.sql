
-- إضافة مفاتيح Remote Config لضبط سلوك Test Lab
INSERT INTO public.remote_config (key, value, value_type, description, category) VALUES

-- التحكم في المرجع الزمني لوضع "رسالة يدوية" في Test Lab
-- true  = استخدام "الآن" كمرجع (الإعداد الصحيح — يجد رسائل الجهاز الحقيقية)
-- false = استخدام occurredAt من نص الرسالة (السلوك القديم — يُفوِّت الرسائل)
('test_lab_manual_use_now',
  'true',
  'boolean',
  'وضع Test Lab (رسالة يدوية): استخدام now() بدلاً من occurredAt كمرجع زمني. يجب أن يكون true دائماً لأن occurredAt من رسالة 2021 يرفض رسائل 2026.',
  'test_lab'),

-- نافذة البحث للخلف من "الآن" في Test Lab (بالأيام)
('test_lab_search_window_days',
  '365',
  'number',
  'نافذة البحث للخلف في Test Lab (بالأيام من now()). قيمة كبيرة تضمن إيجاد الرسائل القديمة.',
  'test_lab'),

-- الحد الأقصى لرسائل Test Lab
('test_lab_max_messages',
  '1000',
  'number',
  'الحد الأقصى للرسائل المقروءة في وضع Test Lab.',
  'test_lab')

ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      description = EXCLUDED.description,
      updated_at = now();
