import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY"), url = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!apiKey || !url || !serviceKey) return json({ error: "A função não possui as credenciais necessárias." }, 500);
    const bearer = request.headers.get("Authorization") || "";
    const admin = createClient(url, serviceKey);
    const { data: authData, error: authError } = await admin.auth.getUser(bearer.replace(/^Bearer\s+/i, ""));
    if (authError || !authData.user) return json({ error: "Sessão inválida." }, 401);
    const body = await request.json(), rubric = body.rubric_items || [];
    if (!body.statement || !body.answer_text || !body.essay_question_id || !rubric.length) return json({ error: "Enunciado, questão, resposta e critérios são obrigatórios." }, 400);
    const userId = authData.user.id, startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { count, error: countError } = await admin.from("essay_attempts").select("id", { count: "exact", head: true }).eq("user_id", userId).not("corrected_at", "is", null).gte("corrected_at", startOfMonth);
    if (countError) throw countError;
    let credit: any = null;
    if ((count || 0) >= 4) {
      if (!body.authorization_token?.trim()) return json({ error: "Você atingiu as 4 correções deste mês. Informe um token de autorização extra." }, 429);
      const { data, error } = await admin.from("essay_correction_credits").select("*").eq("user_id", userId).eq("token", body.authorization_token.trim()).is("used_at", null).maybeSingle();
      if (error || !data) return json({ error: "Token de autorização inválido, usado ou destinado a outro usuário." }, 403);
      credit = data;
    }
    const max = rubric.reduce((sum: number, item: any) => sum + Number(item.max_points || 0), 0);
    const prompt = `Você é corretor jurídico pedagógico. Avalie SOMENTE os critérios oficiais. Não invente critérios ou fundamentos. Aceite redação equivalente. Pequenos erros gramaticais só importam se impedirem compreensão. A soma não pode ultrapassar ${max}. Retorne APENAS JSON válido.\nENUNCIADO:\n${body.statement}\nESPELHO:\n${body.answer_key_text || ""}\nCRITÉRIOS:\n${JSON.stringify(rubric)}\nRESPOSTA:\n${body.answer_text}\nFormato: {"score":number,"max_score":${max},"percentage":number,"summary":"string","criteria":[{"rubric_item_id":"id","status":"hit|partial|missed","achieved_points":number,"max_points":number,"feedback":"string","evidence_excerpt":"string"}],"disclaimer":"Correção assistida por IA, baseada no espelho oficial cadastrado. A avaliação humana pode divergir."}`;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.15 } }) });
    const data = await response.json(); if (!response.ok) return json({ error: data?.error?.message || "Erro Gemini" }, response.status);
    const result = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}"); result.max_score = max; result.score = Math.min(max, Math.max(0, Number(result.score || 0))); result.percentage = max ? Math.round((result.score / max) * 10000) / 100 : 0;
    if (credit) await admin.from("essay_correction_credits").update({ used_at: new Date().toISOString() }).eq("id", credit.id);
    return json(result);
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500); }
});
