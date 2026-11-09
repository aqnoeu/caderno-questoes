import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function count(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function remaining(headers: Headers, key: string) {
  const value = headers.get(key);
  return value && /^\d+$/.test(value) ? count(Number(value)) : null;
}

export function trackAiFetch(functionName: string) {
  return async (url: string, options: RequestInit) => {
    const provider = new URL(url).hostname === "api.groq.com" ? "groq" : "gemini";
    const model =
      provider === "groq"
        ? JSON.parse(String(options.body)).model
        : url.match(/\/models\/([^:]+):/)?.[1];
    const startedAt = new Date().toISOString();
    async function record(response?: Response) {
      try {
        const payload = response ? await response.json().catch(() => null) : null;
        const headers = response?.headers ?? new Headers();
        const client = createClient(
          Deno.env.get("SUPABASE_URL") || "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
          {
            auth: { persistSession: false },
          },
        );
        const { error } = await client.from("ai_usage_events").insert({
          started_at: startedAt,
          provider,
          model: model || "desconhecido",
          function_name: functionName,
          http_status: response?.status ?? null,
          total_tokens: count(
            payload?.usage?.total_tokens ?? payload?.usageMetadata?.totalTokenCount,
          ),
          remaining_requests:
            provider === "groq" ? remaining(headers, "x-ratelimit-remaining-requests") : null,
          remaining_tokens:
            provider === "groq" ? remaining(headers, "x-ratelimit-remaining-tokens") : null,
        });
        if (error) console.warn("Falha ao registrar consumo de IA", error.code);
      } catch {
        console.warn("Falha ao registrar consumo de IA");
      }
    }
    function schedule(response?: Response) {
      const task = record(response);
      const runtime = (
        globalThis as typeof globalThis & {
          EdgeRuntime?: { waitUntil(promise: Promise<void>): void };
        }
      ).EdgeRuntime;
      runtime?.waitUntil(task);
      return runtime ? Promise.resolve() : task;
    }
    let response: Response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      await schedule();
      throw error;
    }
    await schedule(response.clone());
    return response;
  };
}
