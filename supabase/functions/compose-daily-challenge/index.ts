import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { trackAiFetch } from "../_shared/ai-usage.ts";

const fetchAi = trackAiFetch("compose-daily-challenge");

// v55: a IA escolhe as afirmações do desafio do dia entre as APROVADAS do banco de desafios (criadas à mão, em lote ou adaptadas pela IA).
// Só o administrador chama. O resultado é salvo como RASCUNHO para a data pedida; quem publica é o administrador.
// Entrada: { date: "AAAA-MM-DD", count?: 5 | 10 }   Saída: { challenge_id, question_ids, method: "ia" | "regra", note? }

const SITE_ORIGIN = Deno.env.get("SITE_ORIGIN") || "https://caderno-questoes.vercel.app";
const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash";
const COOLDOWN_DAYS = 14;
const MAX_CANDIDATES = 80;

function corsFor(request: Request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = origin === SITE_ORIGIN || /^https:\/\/caderno-questoes[a-z0-9-]*\.vercel\.app$/.test(origin) || /^http:\/\/localhost:\d+$/.test(origin);
  return { "Access-Control-Allow-Origin": allowed ? origin : SITE_ORIGIN, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class GeminiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function askGemini(apiKey: string, prompt: string, temperature = 0.3): Promise<any> {
  let status = 500;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetchAi(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature } }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      return JSON.parse(text);
    }
    status = response.status;
    const quota = /quota|billing/i.test(String(data?.error?.message || ""));
    if ((status === 503 || status === 500 || (status === 429 && !quota)) && attempt < 3) { await sleep(attempt * 1500); continue; }
    break;
  }
  throw new Error(`Gemini indisponível (${status})`);
}

// v59: roteamento de IA. Tarefas auxiliares tentam a Groq primeiro e usam o Gemini como segurança.
// AI_ROTA_DESAFIO: "auto" (padrão: Groq e, se falhar, Gemini) | "groq" (só Groq, para testar) | "gemini" (só Gemini).
const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.3-70b-versatile";
const AI_ROUTE = (Deno.env.get("AI_ROTA_DESAFIO") || "auto").toLowerCase();

async function askGroq(apiKey: string, prompt: string, temperature: number): Promise<any> {
  const response = await fetchAi("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: GROQ_MODEL, temperature, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Responda sempre em português do Brasil e somente com um objeto JSON válido." }, { role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(45000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Groq ${response.status}: ${String(data?.error?.message || "").slice(0, 160)}`);
  const text = String(data?.choices?.[0]?.message?.content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(text);
}

async function askAI(prompt: string, temperature: number, groqPrompt?: string): Promise<{ data: any; provider: string }> {
  const groqKey = Deno.env.get("GROQ_API_KEY"), geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (AI_ROUTE !== "gemini" && groqKey) {
    try { return { data: await askGroq(groqKey, groqPrompt || prompt, temperature), provider: `groq:${GROQ_MODEL}` }; }
    catch (error) {
      console.warn("Groq falhou:", error instanceof Error ? error.message : error);
      if (AI_ROUTE === "groq" || !geminiKey) throw new GeminiError(502, "A IA reserva (Groq) não respondeu agora. Tente novamente em instantes.");
    }
  }
  if (!geminiKey) throw new GeminiError(500, "Nenhuma chave de IA está configurada.");
  return { data: await askGemini(geminiKey, prompt, temperature), provider: `gemini:${MODEL}` };
}

// Escolha por regra, usada quando a IA falha ou devolve algo inválido: equilibra Sim/Não e disciplinas, prioriza o menos usado e o que mais errado.
function pickByRule(pool: any[], count: number) {
  const maxTrue = Math.ceil(count * 0.6), maxFalse = Math.ceil(count * 0.6), perDiscipline = count === 10 ? 3 : 2;
  const sorted = [...pool].sort((a, b) => (a.times_used - b.times_used) || (b.error_rate - a.error_rate) || (Math.random() - 0.5));
  const chosen: any[] = [], byDiscipline = new Map<string, number>();
  let yes = 0, no = 0;
  for (const item of sorted) {
    if (chosen.length >= count) break;
    const key = item.discipline || "—";
    if ((byDiscipline.get(key) || 0) >= perDiscipline) continue;
    if (item.correct_answer ? yes >= maxTrue : no >= maxFalse) continue;
    chosen.push(item); byDiscipline.set(key, (byDiscipline.get(key) || 0) + 1);
    if (item.correct_answer) yes++; else no++;
  }
  for (const item of sorted) { if (chosen.length >= count) break; if (!chosen.includes(item)) chosen.push(item); }
  return chosen;
}

Deno.serve(async (request) => {
  const cors = corsFor(request);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const hasAI = Boolean(Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GROQ_API_KEY")), url = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ error: "A função não possui as credenciais necessárias." }, 500);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""));
    if (authError || !authData.user) return json({ error: "Sessão inválida." }, 401);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
    if (profile?.role !== "admin") return json({ error: "Acesso restrito ao administrador." }, 403);

    const body = await request.json().catch(() => ({}));
    const date = String(body.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Informe a data do desafio." }, 400);
    const count = Number(body.count) === 5 ? 5 : 10;

    const { data: existing, error: existingError } = await admin.from("daily_challenges").select("id, status").eq("challenge_date", date).maybeSingle();
    if (existingError) throw existingError;
    if (existing?.status === "published") return json({ error: "Já existe um desafio publicado nesta data; ele não pode ser alterado." }, 409);

    const { data: bank, error: bankError } = await admin.from("challenge_questions").select("id, statement, correct_answer, discipline, subject, times_used, last_used_at").eq("active", true).eq("administratively_available", true).eq("review_status", "approved");
    if (bankError) throw bankError;
    const { data: answers } = await admin.from("challenge_attempt_answers").select("question_id, correct").limit(20000);
    const stats = new Map<string, { total: number; wrong: number }>();
    for (const row of answers || []) { const s = stats.get(row.question_id) || { total: 0, wrong: 0 }; s.total++; if (!row.correct) s.wrong++; stats.set(row.question_id, s); }
    const cutoff = new Date(date + "T00:00:00Z").getTime() - COOLDOWN_DAYS * 86400000;
    const all = (bank || []).map((row: any) => { const s = stats.get(row.id); return { ...row, error_rate: s && s.total >= 3 ? Math.round((s.wrong / s.total) * 100) / 100 : null, recent: row.last_used_at ? new Date(row.last_used_at + "T00:00:00Z").getTime() > cutoff : false }; });
    const fresh = all.filter((row) => !row.recent);
    const pool = (fresh.length >= count ? fresh : all).sort(() => Math.random() - 0.5).slice(0, MAX_CANDIDATES).map((row) => ({ ...row, error_rate: row.error_rate ?? 0 }));
    if (pool.length < count) return json({ error: `Há apenas ${pool.length} afirmação(ões) aprovada(s) disponível(is); são necessárias ${count}. Aprove mais rascunhos ou cadastre novas.` }, 400);

    const byId = new Map(pool.map((row) => [row.id, row]));
    let chosen: any[] | null = null, method = "regra", note = "", provider = "regra";
    if (hasAI) {
      try {
        const list = (rows: any[], size: number) => JSON.stringify(rows.map((row) => ({ id: row.id, correct_answer: row.correct_answer, discipline: row.discipline, subject: row.subject, times_used: row.times_used, error_rate: row.error_rate, statement: String(row.statement).slice(0, size) })));
        const build = (items: string) => `Você monta o desafio diário de ${count} afirmações de SIM/NÃO de uma plataforma de estudos jurídicos (OAB, procuradoria, magistratura). Escolha EXATAMENTE ${count} ids da lista, sem repetir.
Regras: (1) equilibre as respostas: entre ${Math.floor(count * 0.4)} e ${Math.ceil(count * 0.6)} com correct_answer true; (2) no máximo ${count === 10 ? 3 : 2} da mesma disciplina; (3) prefira afirmações nunca usadas ou menos usadas (times_used) e, em empate, as de maior error_rate (os alunos mais erram); (4) varie os assuntos; (5) ordene do mais acessível ao mais difícil, sem pôr duas da mesma disciplina em sequência. Use somente ids da lista.
Retorne APENAS JSON: {"ids":["..."],"note":"uma frase explicando o critério"}

LISTA:
${items}`;
        // A Groq tem limite baixo de texto por minuto: ela recebe uma lista menor e mais curta; o Gemini recebe a lista completa.
        const evaluate = (result: any) => {
          const ids: string[] = Array.isArray(result?.ids) ? result.ids.map(String) : [];
          const picked = ids.map((id) => byId.get(id));
          const yes = picked.filter((row) => row?.correct_answer).length;
          const perDiscipline = new Map<string, number>(); for (const row of picked) if (row) perDiscipline.set(row.discipline || "—", (perDiscipline.get(row.discipline || "—") || 0) + 1);
          const valid = ids.length === count && new Set(ids).size === count && picked.every(Boolean) && yes >= Math.floor(count * 0.4) && yes <= Math.ceil(count * 0.6) && [...perDiscipline.values()].every((n) => n <= (count === 10 ? 3 : 2));
          return valid ? picked as any[] : null;
        };
        let answer = await askAI(build(list(pool, 220)), 0.3, build(list(pool.slice(0, 40), 160)));
        let picked = evaluate(answer.data);
        const geminiKey = Deno.env.get("GEMINI_API_KEY");
        if (!picked && answer.provider.startsWith("groq") && AI_ROUTE !== "groq" && geminiKey) {
          answer = { data: await askGemini(geminiKey, build(list(pool, 220)), 0.3), provider: `gemini:${MODEL}` };
          picked = evaluate(answer.data);
        }
        provider = answer.provider;
        if (picked) { chosen = picked; method = "ia"; note = String(answer.data?.note || "").slice(0, 300); }
        else note = "A sugestão da IA não respeitou as regras e foi substituída pela escolha por regra.";
      } catch (_) { note = "A IA estava indisponível; a escolha foi feita por regra."; }
    } else note = "A chave da IA não está configurada; a escolha foi feita por regra.";
    if (!chosen) chosen = pickByRule(pool, count);

    let challengeId = existing?.id as string | undefined;
    if (challengeId) {
      const { error } = await admin.from("daily_challenges").update({ question_count: count }).eq("id", challengeId);
      if (error) throw error;
      const { error: deleteError } = await admin.from("daily_challenge_questions").delete().eq("challenge_id", challengeId);
      if (deleteError) throw deleteError;
    } else {
      const { data, error } = await admin.from("daily_challenges").insert({ challenge_date: date, status: "draft", question_count: count }).select("id").single();
      if (error) throw error;
      challengeId = data.id;
    }
    const { error: insertError } = await admin.from("daily_challenge_questions").insert(chosen.map((row, index) => ({ challenge_id: challengeId, question_id: row.id, position: index + 1 })));
    if (insertError) throw insertError;
    return json({ challenge_id: challengeId, question_ids: chosen.map((row) => row.id), method, note, provider });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});
