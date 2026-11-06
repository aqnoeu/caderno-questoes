import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Classificação por IA do cadastro de questões objetivas (tela "Cadastro" do administrador).
// Recriada na v53: o site já chamava esta função, mas ela não existia no Supabase nem no repositório.
// Entrada: { classification_instruction?, questions: [{ index, statement, alternatives: {A: "...", ...}, correct_option }] }
// Saída:  { results: [{ index, discipline, subject, explanation, difficulty, confidence }] }

const SITE_ORIGIN = Deno.env.get("SITE_ORIGIN") || "https://caderno-questoes.vercel.app";
const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash";
const MAX_QUESTIONS = 10;

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
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } }),
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

Deno.serve(async (request) => {
  const cors = corsFor(request);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY"), url = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!apiKey || !url || !serviceKey) return json({ error: "A função não possui as credenciais necessárias." }, 500);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""));
    if (authError || !authData.user) return json({ error: "Sessão inválida." }, 401);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
    if (profile?.role !== "admin") return json({ error: "Acesso restrito ao administrador." }, 403);

    const body = await request.json().catch(() => ({}));
    const questions = Array.isArray(body.questions) ? body.questions : [];
    if (!questions.length) return json({ error: "Envie ao menos uma questão." }, 400);
    if (questions.length > MAX_QUESTIONS) return json({ error: `Envie no máximo ${MAX_QUESTIONS} questões por vez.` }, 400);
    const instruction = String(body.classification_instruction || "").slice(0, 1200);

    const prompt = `Você é professor de Direito e organiza questões objetivas para um banco de estudos. Use SOMENTE o enunciado, as alternativas e o gabarito informados. Não invente lei, súmula, jurisprudência ou fato. A prova pode conter ruído de PDF.
Para cada questão informe: a disciplina (por exemplo "Direito Penal"), o assunto, uma explicação didática curta do gabarito (por que a alternativa correta está certa e, em uma frase, o erro das demais), a dificuldade e sua confiança de 0 a 1.
${instruction}
Retorne APENAS JSON válido.

QUESTÕES:
${JSON.stringify(questions)}

Formato obrigatório:
{"results":[{"index":0,"discipline":"string","subject":"assunto 1 · assunto 2","explanation":"string","difficulty":"facil|media|dificil","confidence":0.0}]}`;

    const result = await askGemini(apiKey, prompt);
    const results = (Array.isArray(result.results) ? result.results : []).map((item: any) => ({
      index: Number(item?.index),
      discipline: String(item?.discipline || "").trim(),
      subject: Array.isArray(item?.subject) ? item.subject.map((value: unknown) => String(value).trim()).filter(Boolean).join(" · ") : String(item?.subject || "").trim(),
      explanation: String(item?.explanation || "").trim(),
      difficulty: ["facil", "media", "dificil"].includes(item?.difficulty) ? item.difficulty : "media",
      confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
    })).filter((item: any) => Number.isInteger(item.index));
    return json({ results });
  } catch (error) {
    if (error instanceof GeminiError) return json({ error: error.message }, error.status);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});
