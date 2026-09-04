import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "A chave GEMINI_API_KEY não foi configurada." }, 500);
    const body = await request.json();
    const rubric = body.rubric_items || [];
    if (!body.statement || !body.answer_text || !rubric.length) return json({ error: "Enunciado, resposta e critérios são obrigatórios." }, 400);
    const max = rubric.reduce((sum: number, item: any) => sum + Number(item.max_points || 0), 0);
    const prompt = `Você é corretor jurídico pedagógico. Avalie SOMENTE os critérios oficiais informados. Não invente critérios, fatos ou fundamentos. Aceite redação equivalente; não exija cópia literal. Pequenos erros gramaticais só importam se impedirem compreensão. A soma não pode ultrapassar ${max}. Retorne APENAS JSON válido.

ENUNCIADO:\n${body.statement}\n
ESPELHO OFICIAL:\n${body.answer_key_text || ""}\n
CRITÉRIOS:\n${JSON.stringify(rubric)}\n
RESPOSTA DO ALUNO:\n${body.answer_text}\n
Formato obrigatório:
{"score":number,"max_score":${max},"percentage":number,"summary":"string","strengths":["string"],"improvements":["string"],"criteria":[{"rubric_item_id":"id","status":"hit|partial|missed","achieved_points":number,"max_points":number,"feedback":"string","evidence_excerpt":"string"}],"disclaimer":"Correção assistida por IA, baseada no espelho oficial cadastrado. A avaliação humana pode divergir."}`;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.15 } }) });
    const data = await response.json();
    if (!response.ok) return json({ error: data?.error?.message || "Erro Gemini" }, response.status);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const result = JSON.parse(text);
    result.max_score = max;
    result.score = Math.min(max, Math.max(0, Number(result.score || 0)));
    result.percentage = max ? Math.round((result.score / max) * 10000) / 100 : 0;
    return json(result);
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500); }
});
