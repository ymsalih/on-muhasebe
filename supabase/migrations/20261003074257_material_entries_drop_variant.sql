-- Malzeme girişlerinden "cinsi / çeşidi / çapı" alanı kaldırıldı (içinde veri yoktu).
-- Malzeme bazlı maliyet kırılımı artık ad + birime göre gruplanır.
ALTER TABLE public.material_entries DROP COLUMN variant;

CREATE OR REPLACE FUNCTION public.get_material_cost_breakdown(p_site_id INTEGER, p_from DATE, p_to DATE, p_by TEXT)
RETURNS TABLE (group_key TEXT, label TEXT, unit TEXT, entry_count INTEGER, total_quantity NUMERIC, total NUMERIC)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_by NOT IN ('partner', 'item', 'usage') THEN
    RAISE EXCEPTION 'Geçersiz kırılım' USING ERRCODE = '22023';
  END IF;

  IF p_by = 'partner' THEN
    RETURN QUERY
    SELECT COALESCE(e.created_by::text, ''), COALESCE(MAX(u.full_name)::text, 'Bilinmiyor'), NULL::text,
           COUNT(*)::integer, NULL::numeric, SUM(e.total_amount)
    FROM public.material_entries e
    LEFT JOIN public.users u ON u.id = e.created_by
    WHERE e.site_id = p_site_id AND e.entry_date BETWEEN p_from AND p_to
    GROUP BY e.created_by
    ORDER BY 6 DESC;
  ELSIF p_by = 'item' THEN
    RETURN QUERY
    SELECT lower(e.name) || '|' || lower(e.unit),
           MIN(e.name)::text,
           MIN(e.unit)::text, COUNT(*)::integer, SUM(e.quantity), SUM(e.total_amount)
    FROM public.material_entries e
    WHERE e.site_id = p_site_id AND e.entry_date BETWEEN p_from AND p_to
    GROUP BY lower(e.name), lower(e.unit)
    ORDER BY 6 DESC;
  ELSE
    RETURN QUERY
    SELECT lower(COALESCE(btrim(e.used_for), '')),
           COALESCE(NULLIF(MIN(btrim(e.used_for)), ''), 'Belirtilmemiş')::text, NULL::text,
           COUNT(*)::integer, NULL::numeric, SUM(e.total_amount)
    FROM public.material_entries e
    WHERE e.site_id = p_site_id AND e.entry_date BETWEEN p_from AND p_to
    GROUP BY lower(COALESCE(btrim(e.used_for), ''))
    ORDER BY 6 DESC;
  END IF;
END;
$$;
