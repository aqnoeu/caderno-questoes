import React from "react";
import { resolveNotebookV63 } from "./system2";

const letters = "ABCDEFGH";
const fields = [
  ["concurso", "Concurso", 300],
  ["banca", "Banca", 200],
  ["ano", "Ano", 2100],
  ["question_number", "Número na prova", 2147483647],
  ["contest_cargo", "Cargo", 300],
];
const empty = {
  concurso: "",
  banca: "",
  ano: "",
  question_number: "",
  contest_cargo: "",
  statement: "",
  answer_key_text: "",
};

export function ObjectiveSuggestion({ supabase, suggestion, onSubmitted }) {
  const [form, setForm] = React.useState(suggestion || empty);
  const [alternatives, setAlternatives] = React.useState(
    suggestion?.objective_options || ["", "", "", ""],
  );
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const patch = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event) {
    event.preventDefault();
    if (
      !form.concurso.trim() ||
      !form.banca.trim() ||
      !form.statement.trim() ||
      alternatives.some((option) => !option.trim()) ||
      !form.answer_key_text
    ) {
      setMessage("Confira os dados da prova, o enunciado, as alternativas e o gabarito.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      if (suggestion) {
        const destination = await resolveNotebookV63(
          supabase,
          form.concurso,
          form.contest_cargo,
          [],
          1,
        );
        const { error } = await supabase.rpc("queue_objective_suggestion", {
          suggestion_id: suggestion.id,
          notebook: destination.notebook_id,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("essay_suggestions").insert({
          ...Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()])),
          question_type: "objective",
          discipline: "",
          objective_options: alternatives.map((option) => option.trim()),
        });
        if (error) throw error;
        setForm(empty);
        setAlternatives(["", "", "", ""]);
        setMessage("Questão objetiva enviada para aprovação.");
      }
      onSubmitted();
    } catch (error) {
      setMessage(error.message || "Não foi possível enviar a questão.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card system2-form" onSubmit={submit}>
      <h2>{suggestion ? "Encaminhar objetiva aprovada" : "Sugerir questão objetiva"}</h2>
      <p>
        {suggestion
          ? "Confira a sugestão antes de encaminhá-la ao Filtro de IA."
          : "Informe o enunciado, as alternativas e o gabarito oficial."}
      </p>
      <fieldset className="objective-suggestion-fields" disabled={busy}>
        <div className="system2-fields">
          {fields.map(([key, label, limit]) => {
            const numeric = key === "ano" || key === "question_number";
            return (
              <label key={key}>
                {label}
                <input
                  type={numeric ? "number" : "text"}
                  min={numeric ? (key === "ano" ? 1900 : 1) : undefined}
                  max={numeric ? limit : undefined}
                  maxLength={numeric ? undefined : limit}
                  required={key !== "contest_cargo"}
                  readOnly={Boolean(suggestion)}
                  value={form[key]}
                  onChange={(event) => patch(key, event.target.value)}
                />
              </label>
            );
          })}
        </div>
        <label>
          Enunciado
          <textarea
            rows={6}
            maxLength={50000}
            required
            readOnly={Boolean(suggestion)}
            value={form.statement}
            onChange={(event) => patch("statement", event.target.value)}
          />
        </label>
        {alternatives.map((value, index) => (
          <label key={letters[index]}>
            Alternativa {letters[index]}
            <textarea
              rows={2}
              maxLength={10000}
              required
              readOnly={Boolean(suggestion)}
              value={value}
              onChange={(event) =>
                setAlternatives((current) =>
                  current.map((option, i) => (i === index ? event.target.value : option)),
                )
              }
            />
          </label>
        ))}
        {!suggestion && (
          <div className="study-actions">
            <button
              type="button"
              className="light"
              disabled={alternatives.length >= letters.length}
              onClick={() => setAlternatives([...alternatives, ""])}
            >
              Adicionar alternativa
            </button>
            <button
              type="button"
              className="light"
              disabled={alternatives.length <= 2}
              onClick={() => {
                if (form.answer_key_text === letters[alternatives.length - 1])
                  patch("answer_key_text", "");
                setAlternatives(alternatives.slice(0, -1));
              }}
            >
              Remover última alternativa
            </button>
          </div>
        )}
        <label>
          Gabarito oficial
          <select
            required
            disabled={Boolean(suggestion)}
            value={form.answer_key_text}
            onChange={(event) => patch("answer_key_text", event.target.value)}
          >
            <option value="">Selecione a alternativa correta</option>
            {alternatives.map((_, index) => (
              <option key={letters[index]}>{letters[index]}</option>
            ))}
          </select>
        </label>
        <button type="submit">
          {busy ? "Enviando…" : suggestion ? "Enviar ao Filtro de IA" : "Enviar para aprovação"}
        </button>
      </fieldset>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
