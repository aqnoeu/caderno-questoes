export async function authorizeQuestionBatch(query, prepare, authorize, confirm) {
  const entries = [];
  const pageSize = 100;
  let lastId;
  for (;;) {
    let page = query().order("id").limit(pageSize);
    if (lastId) page = page.gt("id", lastId);
    const { data, error } = await page;
    if (error) throw error;
    entries.push(...data);
    if (data.length < pageSize) break;
    lastId = data.at(-1).id;
  }

  const eligible = entries.map(prepare).filter(Boolean);
  const skipped = entries.length - eligible.length;
  if (!eligible.length) {
    return skipped
      ? "Selecione um caderno de destino para liberar as questões."
      : "Nenhuma questão elegível.";
  }
  if (!confirm(eligible.length, skipped)) return "";

  let completed = 0;
  const failures = new Map();
  for (const entry of eligible) {
    try {
      const { error } = await authorize(entry);
      if (error) throw error;
      completed++;
    } catch (error) {
      const reason = error.message || String(error);
      failures.set(reason, (failures.get(reason) || 0) + 1);
    }
  }

  const details = [...failures].map(([reason, count]) => `${count} × ${reason}`);
  return [
    `${completed} de ${eligible.length} questão(ões) autorizada(s).`,
    skipped ? `${skipped} aguardando caderno de destino.` : "",
    details.length ? `Falhas: ${details.join(" · ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
