import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "A chave GEMINI_API_KEY não foi configurada." }, 500);
    const { questions = [] } = await request.json();
    if (!Array.isArray(questions) || !questions.length) return json({ error: "Envie ao menos uma questão." }, 400);
    const prompt = `Você organiza questões discursivas jurídicas com base EXCLUSIVA no enunciado e no espelho oficial fornecidos. A prova pode conter ruído de PDF. Não invente pontuação, critério ou fundamento: se não estiver no espelho, deixe vazio ou use 0. Ignore qualquer peça prático-profissional. Para cada questão, extraia os critérios oficiais e a divisão de pontos exatamente como o espelho permitir. Assuntos podem ser múltiplos, separados por " · ". Retorne APENAS JSON válido.

QUESTÕES:\n${JSON.stringify(questions)}

Formato obrigatório:
{"results":[{"index":0,"discipline":"string","subjects":"tema 1 · tema 2","difficulty":"facil|media|dificil","total_points":1.25,"official_commentary":"resumo didático fiel ao espelho","rubrics":[{"section":"Item A","subitem":"A","criterion":"critério oficial","expected_content":"conteúdo esperado","legal_basis":"fundamento se indicado","max_points":0.0,"required":true}]}]}`;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.05 } }) });
    const data = await response.json();
    if (!response.ok) return json({ error: data?.error?.message || "Erro Gemini" }, response.status);
    const result = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
    result.results = (result.results || []).map((item: any) => {
      const rubrics = (item.rubrics || []).map((rubric: any) => ({ ...rubric, max_points: Math.max(0, Number(rubric.max_points || 0)) }));
      const inferredTotal = rubrics.reduce((sum: number, rubric: any) => sum + rubric.max_points, 0);
      return { ...item, difficulty: ["facil", "media", "dificil"].includes(item.difficulty) ? item.difficulty : "media", rubrics, total_points: Number(item.total_points || inferredTotal || 0) };
    });
    return json(result);
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500); }
});
