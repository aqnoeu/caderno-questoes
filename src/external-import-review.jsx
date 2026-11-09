import React from "react";
import { resolveNotebookV63, System2List, System2QuestionCardV2 } from "./system2";

const types = { objective: "Objetiva", discursive: "Discursiva", piece: "Peça processual" };
const labels = {
  pending: "Aguardando conferência",
  incomplete: "Com pendências",
  ready: "Sem campos faltantes",
  released: "Encaminhadas",
};

export function ExternalImportReview({ supabase }) {
  const [timer, setTimer] = React.useState(null);
  const [interval, setIntervalMinutes] = React.useState("");
  const [now, setNow] = React.useState(Date.now);
  const [rows, setRows] = React.useState([]);
  const [view, setView] = React.useState("pending");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const load = React.useCallback(async () => {
    const { data, error } = await supabase
      .from("external_question_imports")
      .select(
        "id,batch_name,modality,payload,revision,status,missing_fields,created_at,review_claim_until,review_retry_at,review_error",
      )
      .eq("status", view)
      .order("created_at", { ascending: false });
    if (error) setMessage(error.message);
    else setRows(data);
  }, [supabase, view]);

  React.useEffect(() => {
    load();
  }, [load]);

  const loadTimer = React.useCallback(async () => {
    const { data, error } = await supabase
      .from("external_import_timer")
      .select("enabled,interval_minutes,last_started_at")
      .eq("id", true)
      .single();
    if (error) setMessage(error.message);
    else setTimer(data);
  }, [supabase]);

  React.useEffect(() => {
    loadTimer();
    const refresh = window.setInterval(() => {
      load();
      loadTimer();
    }, 15000);
    return () => window.clearInterval(refresh);
  }, [load, loadTimer]);

  React.useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  async function saveTimer(event) {
    event.preventDefault();
    const enabled = event.nativeEvent.submitter?.value !== "pause";
    const interval_minutes = Number(interval || timer.interval_minutes);
    setBusy(true);
    try {
      const { error } = await supabase
        .from("external_import_timer")
        .update({ enabled, interval_minutes })
        .eq("id", true);
      if (error) throw error;
      setIntervalMinutes("");
      await loadTimer();
      setMessage(enabled ? "Conferência automática ativada." : "Conferência automática pausada.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  const seconds = Math.max(
    0,
    Math.ceil(
      ((Date.parse(timer?.last_started_at) || 0) + (timer?.interval_minutes || 0) * 60000 - now) /
        1000,
    ),
  );

  async function act(row, action) {
    setBusy(true);
    setMessage("");
    try {
      if (action === "check") {
        const { data, error } = await supabase.functions.invoke("check-external-import", {
          body: { id: row.id },
        });
        if (error) {
          const detail = await error.context?.json?.().catch(() => null);
          throw new Error(detail?.error || error.message);
        }
        setMessage(
          data.status === "ready"
            ? "Conferência concluída. A questão está pronta para revisão final."
            : "Confira os campos apontados na aba Com pendências.",
        );
      } else {
        const p = row.payload;
        const notebook = await resolveNotebookV63(supabase, p.concurso, p.cargo, [p.discipline], 1);
        const { error } = await supabase.rpc("release_external_question_import", {
          import_row_id: row.id,
          expected_revision: row.revision,
          notebook: notebook.notebook_id,
        });
        if (error) throw error;
        setMessage(
          row.modality === "objective"
            ? "Questão encaminhada ao Controle de Conteúdo para promoção."
            : "Questão cadastrada no caderno.",
        );
      }
      await Promise.all([load(), loadTimer()]);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="system2-page">
      <span className="eyebrow">GESTÃO</span>
      <h1>Revisão de importações</h1>
      <p>
        Confira o preenchimento das objetivas, discursivas e peças cadastradas pelo assistente. A
        conferência aponta campos faltantes e textos provisórios.
      </p>
      {timer && (
        <form className="card system2-form" onSubmit={saveTimer}>
          <h2>Conferência automática com Groq</h2>
          <p>
            {timer.enabled
              ? seconds > 0
                ? `Próxima questão elegível em ${Math.floor(seconds / 60)} min e ${seconds % 60} s.`
                : "Fila elegível para a próxima verificação do servidor."
              : "Automação pausada."}
          </p>
          <label>
            Intervalo entre questões (minutos)
            <input
              type="number"
              min="1"
              max="60"
              required
              value={interval || timer.interval_minutes}
              onChange={(event) => setIntervalMinutes(event.target.value)}
            />
          </label>
          <div className="study-actions">
            <button type="submit" disabled={busy}>
              {timer.enabled ? "Salvar intervalo" : "Ativar conferência"}
            </button>
            {timer.enabled && (
              <button type="submit" value="pause" className="light" disabled={busy}>
                Pausar
              </button>
            )}
          </div>
        </form>
      )}
      <nav className="study-actions" aria-label="Situação da importação">
        {Object.entries(labels).map(([key, label]) => (
          <button
            type="button"
            className={view === key ? "" : "light"}
            key={key}
            aria-pressed={view === key}
            disabled={busy || view === key}
            onClick={() => {
              setRows([]);
              setView(key);
              setMessage("");
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <button type="button" className="light" disabled={busy} onClick={load}>
        Atualizar lista
      </button>
      {message && <p role="status">{message}</p>}
      {rows.length === 0 && <p>Nenhuma importação nesta lista.</p>}
      {rows.some((row) => row.status === view) && (
        <System2List
          key={view}
          items={rows
            .filter((row) => row.status === view)
            .map((row) => ({
              ...row.payload,
              id: row.id,
              status: row.status,
              created_at: row.created_at,
              import: row.payload,
              row,
            }))}
          renderItem={(item) => {
            const row = item.row;
            const objective = row.modality === "objective";
            return (
              <System2QuestionCardV2
                key={row.id}
                item={item}
                importReview={{
                  label: row.review_error || labels[row.status],
                  modality: types[row.modality],
                  batch: row.batch_name,
                  objective,
                  details: (
                    <ImportQuestionDetails
                      item={item}
                      objective={objective}
                      missing={row.missing_fields}
                    />
                  ),
                  actions:
                    row.status === "pending" ? (
                      <button
                        type="button"
                        className="compact"
                        disabled={busy || Date.parse(row.review_claim_until) > now}
                        onClick={() => act(row, "check")}
                      >
                        {Date.parse(row.review_claim_until) > now
                          ? "Em conferência…"
                          : "Conferir preenchimento"}
                      </button>
                    ) : row.status === "ready" ? (
                      <button
                        type="button"
                        className="compact"
                        disabled={busy}
                        onClick={() => act(row, "release")}
                      >
                        {objective ? "Encaminhar ao Controle de Conteúdo" : "Cadastrar no acervo"}
                      </button>
                    ) : null,
                }}
              />
            );
          }}
        />
      )}
    </section>
  );
}

function ImportQuestionDetails({ item, objective, missing }) {
  return (
    <div className="system2-editor">
      <p className="essay-suggestion-text">{item.statement}</p>
      {missing.length > 0 && (
        <section className="system2-analysis-details open">
          <h3>Campos pendentes</h3>
          <ul>
            {missing.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
        </section>
      )}
      {objective ? (
        <>
          {item.answer_key_option && (
            <span className="system2-correct-key">Resposta correta: {item.answer_key_option}</span>
          )}
          {(Array.isArray(item.alternatives) ? item.alternatives : []).map((option, index) => {
            const diagnosis = item.option_error_analysis?.[option?.letter];
            return (
              <section className="system2-option-diagnostic" key={index}>
                <b>
                  {option?.letter}) {option?.text}
                </b>
                {diagnosis?.wrong_reasoning && (
                  <p>
                    <strong>Raciocínio que leva ao erro</strong> {diagnosis.wrong_reasoning}
                  </p>
                )}
                {diagnosis?.student_feedback && <p>{diagnosis.student_feedback}</p>}
                {diagnosis?.study_content && (
                  <p>
                    <strong>Conteúdo de estudo</strong> {diagnosis.study_content}
                  </p>
                )}
              </section>
            );
          })}
          <section className="system2-analysis-details open">
            <h3>Informações de acerto</h3>
            <p>{item.central_rule}</p>
            <p>{item.legal_basis}</p>
            <p>{item.correct_answer_explanation}</p>
          </section>
        </>
      ) : (
        <section className="system2-analysis-details open">
          <h3>Espelho de resposta</h3>
          <p className="essay-suggestion-text">{item.answer_key_text}</p>
          {item.official_commentary && (
            <p className="essay-suggestion-text">{item.official_commentary}</p>
          )}
          {item.total_points != null && (
            <p>
              <strong>Pontuação total</strong> {item.total_points}
            </p>
          )}
          {(Array.isArray(item.rubrics) ? item.rubrics : []).map((rubric, index) => (
            <div className="system2-option-diagnostic" key={index}>
              <b>
                {rubric?.criterion} · {rubric?.max_points} ponto(s)
              </b>
              <p>{rubric?.expected_content}</p>
              <p>{rubric?.legal_basis}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
