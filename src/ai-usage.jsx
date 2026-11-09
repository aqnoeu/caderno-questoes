import React from "react";

const number = new Intl.NumberFormat("pt-BR");
const format = (value) => (value == null ? "—" : number.format(value));
const time = (value) => (value ? new Date(value).toLocaleString("pt-BR") : "—");
const providers = { groq: "Groq", gemini: "Gemini" };
const functions = {
  "analyze-edital": "Análise de edital",
  "analyze-essays": "Análise de discursivas e peças",
  "analyze-questions": "Análise de questões",
  "compose-daily-challenge": "Montagem do desafio diário",
  "correct-essay": "Correção de discursivas",
  "generate-challenge-statements": "Geração de afirmações",
  "prepare-exam-import": "Importação de prova",
  "process-system2-queue": "Fila de análises",
  "revenge-mode": "Modo Revanche",
};

function GeminiLimit({ entry, onSave, busy }) {
  const [limit, setLimit] = React.useState(entry.requests_per_day ?? "");
  const estimated =
    entry.requests_per_day == null ? null : Math.max(0, entry.requests_per_day - entry.calls_today);
  return (
    <article className="card system2-form">
      <h3>{entry.model}</h3>
      <p>
        Chamadas bem-sucedidas registradas hoje <strong>{format(entry.calls_today)}</strong>
      </p>
      <p>
        Requisições restantes (estimativa) <strong>{format(estimated)}</strong>
      </p>
      <form
        className="system2-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(entry.model, limit);
        }}
      >
        <label>
          Limite diário do projeto
          <input
            type="number"
            min="1"
            max="2147483647"
            step="1"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
          />
        </label>
        <button disabled={busy || String(limit) === String(entry.requests_per_day ?? "")}>
          Salvar limite
        </button>
      </form>
    </article>
  );
}

export function AiUsage({ supabase }) {
  const [summary, setSummary] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const refresh = React.useCallback(async () => {
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.rpc("admin_ai_usage_summary");
    if (error) setMessage("Não foi possível carregar o uso de IA.");
    else setSummary(data);
    setBusy(false);
  }, [supabase]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  async function saveLimit(model, value) {
    setBusy(true);
    const table = supabase.from("ai_gemini_daily_limits");
    const { error } =
      value === ""
        ? await table.delete().eq("model", model)
        : await table.upsert({ model, requests_per_day: Number(value) });
    if (error) {
      setMessage("Não foi possível salvar o limite diário.");
      setBusy(false);
      return;
    }
    await refresh();
  }

  return (
    <section className="system2-page ai-usage">
      <span className="eyebrow">ADMINISTRAÇÃO</span>
      <h1>Uso e limites de IA</h1>
      <button className="light" type="button" disabled={busy} onClick={refresh}>
        Atualizar dados
      </button>
      {busy && <p role="status">Atualizando dados…</p>}
      {message && <p role="alert">{message}</p>}
      {summary && (
        <>
          <h2>Groq</h2>
          <p>Cota informada pelo provedor na última chamada registrada de cada modelo.</p>
          {!summary.groq.length && <p>Aguardando respostas com dados de cota.</p>}
          <div className="admin-analysis-grid">
            {summary.groq.map((entry) => (
              <article className="card" key={entry.model}>
                <h3>{entry.model}</h3>
                <p>
                  Requisições restantes no dia <strong>{format(entry.remaining_requests)}</strong>
                </p>
                <p>
                  Tokens restantes no minuto <strong>{format(entry.remaining_tokens)}</strong>
                </p>
                <small>Chamada de {time(entry.started_at)}</small>
              </article>
            ))}
          </div>
          <h2>Gemini</h2>
          <p>
            A estimativa usa o limite informado e as chamadas bem-sucedidas registradas pelo Caderno
            desde a meia-noite no horário do Pacífico. Consulte a cota oficial no{" "}
            <a href="https://aistudio.google.com/rate-limit" target="_blank" rel="noreferrer">
              Google AI Studio
            </a>
            .
          </p>
          {!summary.gemini.length && (
            <p>Os modelos aparecem após as primeiras chamadas registradas.</p>
          )}
          <div className="admin-analysis-grid">
            {summary.gemini.map((entry) => (
              <GeminiLimit key={entry.model} entry={entry} onSave={saveLimit} busy={busy} />
            ))}
          </div>
          <h2>Consumo por função nos últimos 7 dias</h2>
          {summary.breakdown.length ? (
            <div className="ai-usage-table">
              <table>
                <thead>
                  <tr>
                    <th>Função</th>
                    <th>Provedor</th>
                    <th>Modelo</th>
                    <th>Chamadas</th>
                    <th>Tokens informados</th>
                    <th>Erros de limite</th>
                    <th>Último erro de limite</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.breakdown.map((row) => (
                    <tr key={JSON.stringify([row.provider, row.model, row.function_name])}>
                      <td>{functions[row.function_name] || row.function_name}</td>
                      <td>{providers[row.provider]}</td>
                      <td>{row.model}</td>
                      <td>{format(row.calls)}</td>
                      <td>{format(row.tokens)}</td>
                      <td>{format(row.limited)}</td>
                      <td>{time(row.last_limit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Nenhuma chamada registrada no período.</p>
          )}
        </>
      )}
    </section>
  );
}
