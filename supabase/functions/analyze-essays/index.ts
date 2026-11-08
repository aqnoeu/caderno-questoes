import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// v53: restrita ao administrador, com nova tentativa quando o modelo está ocupado e leitura segura do JSON.

const SITE_ORIGIN = Deno.env.get("SITE_ORIGIN") || "https://caderno-questoes.vercel.app";
const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash";
const MAX_QUESTIONS = 20;

function corsFor(request: Request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = origin === SITE_ORIGIN || /^https:\/\/caderno-questoes[a-z0-9-]*\.vercel\.app$/.test(origin) || /^http:\/\/localhost:\d+$/.test(origin);
  return { "Access-Control-Allow-Origin": allowed ? origin : SITE_ORIGIN, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
class GeminiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function askGemini(apiKey: string, prompt: string): Promise<any> {
  let status = 500, message = "Erro Gemini";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.05 } }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      try { return JSON.parse(text); } catch { throw new GeminiError(502, "A IA devolveu uma resposta inválida. Tente novamente."); }
    }
    status = response.status; message = data?.error?.message || message;
    const quota = /quota|billing/i.test(message);
    if ((status === 503 || status === 500 || (status === 429 && !quota)) && attempt < 3) { await sleep(attempt * 1500); continue; }
    break;
  }
  if (status === 429) throw new GeminiError(429, "A IA atingiu o limite de uso no momento. Tente novamente mais tarde.");
  if (status === 503) throw new GeminiError(503, "A IA está com alta demanda. Tente novamente em instantes.");
  throw new GeminiError(status >= 400 ? status : 500, "Não foi possível obter a análise da IA agora.");
}

const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "openai/gpt-oss-120b";
async function askGroq(prompt: string) {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) throw new Error("GROQ_API_KEY não configurada.");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions",{
    method:"POST",
    headers:{ Authorization:`Bearer ${key}`, "Content-Type":"application/json" },
    body:JSON.stringify({ model:GROQ_MODEL,messages:[{role:"system",content:"Organize os dados jurídicos em JSON válido, sem inventar critérios ou pontuação."},{role:"user",content:prompt}],response_format:{type:"json_object"},temperature:0.05 })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Erro Groq ${response.status}`);
  return JSON.parse(String(payload?.choices?.[0]?.message?.content || "{}").replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,""));
}

Deno.serve(async (request) => {
  const cors = corsFor(request);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY"), url = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ error: "A função não possui as credenciais necessárias." }, 500);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""));
    if (authError || !authData.user) return json({ error: "Sessão inválida." }, 401);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
    if (profile?.role !== "admin") return json({ error: "Acesso restrito ao administrador." }, 403);

    const { data: providers } = await admin.from('ai_provider_settings').select('essay_import_provider').eq('id',true).single();
    const provider = providers?.essay_import_provider || 'groq';
    if (provider === 'gemini' && !apiKey) return json({ error:'GEMINI_API_KEY não configurada.' },500);
    const { questions = [] } = await request.json().catch(() => ({}));
    if (!Array.isArray(questions) || !questions.length) return json({ error: "Envie ao menos uma questão." }, 400);
    if (questions.length > MAX_QUESTIONS) return json({ error: `Envie no máximo ${MAX_QUESTIONS} questões por vez.` }, 400);
    const prompt = `Você organiza questões discursivas jurídicas com base EXCLUSIVA no enunciado e no espelho oficial fornecidos. A prova pode conter ruído de PDF. Não invente pontuação, critério ou fundamento: se não estiver no espelho, deixe vazio ou use 0. Quando question_type for 'piece', trate a entrada como uma peça prático-profissional e identifique os critérios, fundamentos, estrutura e pontuação do espelho oficial. Quando question_type for 'discursive', trate como questão discursiva. Não confunda as modalidades e jamais invente critérios ou valores. Para cada questão, extraia os critérios oficiais e a divisão de pontos exatamente como o espelho permitir. Assuntos podem ser múltiplos, separados por " · ". Retorne APENAS JSON válido.\n\nQUESTÕES:\n${JSON.stringify(questions)}\n\nFormato obrigatório:\n{"results":[{"index":0,"discipline":"string","subjects":"tema 1 · tema 2","difficulty":"facil|media|dificil","total_points":1.25,"official_commentary":"resumo didático fiel ao espelho","rubrics":[{"section":"Item A","subitem":"A","criterion":"critério oficial","expected_content":"conteúdo esperado","legal_basis":"fundamento se indicado","max_points":0.0,"required":true}]}]}`;
    const result = provider === 'groq' ? await askGroq(prompt) : await askGemini(apiKey!, prompt);
    result.results = (result.results || []).map((item: any) => {
      const rubrics = (item.rubrics || []).map((rubric: any) => ({ ...rubric, max_points: Math.max(0, Number(rubric.max_points || 0)) }));
      const inferredTotal = rubrics.reduce((sum: number, rubric: any) => sum + rubric.max_points, 0);
      return { ...item, difficulty: ["facil", "media", "dificil"].includes(item.difficulty) ? item.difficulty : "media", rubrics, total_points: Number(item.total_points || inferredTotal || 0) };
    });
    return json(result);
  } catch (error) {
    if (error instanceof GeminiError) return json({ error: error.message }, error.status);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});
