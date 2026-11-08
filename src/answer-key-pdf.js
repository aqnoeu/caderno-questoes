// Reconstrói gabaritos em tabelas a partir da posição das células no PDF.
// Uma tabela de correspondência de numeração NÃO é um gabarito.
const VALID_ANSWER = /^(?:[A-H]|\*|X|ANULAD[AO])$/i;
const parseAnswer = (value) => /^(?:\*|X|ANULAD[AO])$/i.test(value) ? "*" : value.toUpperCase();

function rowsFromPage(content) {
  const cells = (content.items || [])
    .filter((cell) => cell.str?.trim() && Array.isArray(cell.transform))
    .map((cell) => ({
      y: cell.transform[5],
      x: cell.transform[4],
      str: String(cell.str).trim(),
    }));
  const rows = [];
  for (const cell of cells) {
    let row = rows.find((item) => Math.abs(item.y - cell.y) <= 2.5);
    if (!row) { row = { y: cell.y, cells: [] }; rows.push(row); }
    row.cells.push(cell);
  }
  return rows.sort((a, b) => b.y - a.y).map((row) => ({
    tokens: row.cells.sort((a, b) => a.x - b.x)
      .flatMap((cell) => cell.str.split(/\s+/).filter(Boolean)),
  })).filter((row) => row.tokens.length);
}

function tableFromRows(rows) {
  const types = {};
  let currentType = null;
  let lastNumbers = null;
  const issues = [];
  for (const row of rows) {
    const label = row.tokens.join(" ");
    if (/TABELA\s+DE\s+CORRESPOND[ÊE]NCIA/i.test(label)) break;
    const heading = label.match(/\bPROVA\s+TIPO\s*([1-9])\b/i);
    if (heading) {
      currentType = String(Number(heading[1]));
      if (types[currentType]) issues.push("Tipo de prova duplicado: " + currentType);
      else types[currentType] = [];
      lastNumbers = null;
      continue;
    }
    if (!currentType) continue;
    const numbers = row.tokens.filter((token) => /^\d{1,3}$/.test(token));
    if (numbers.length === row.tokens.length && numbers.length >= 5) {
      lastNumbers = numbers.map(Number);
      continue;
    }
    if (lastNumbers && row.tokens.length === lastNumbers.length &&
        row.tokens.every((token) => VALID_ANSWER.test(token))) {
      for (let index = 0; index < lastNumbers.length; index += 1) {
        types[currentType].push({
          question: lastNumbers[index],
          answer: parseAnswer(row.tokens[index]),
        });
      }
      lastNumbers = null;
    }
  }
  for (const [type, answers] of Object.entries(types)) {
    const map = new Map();
    for (const entry of answers) {
      if (map.has(entry.question)) issues.push("Questão duplicada no tipo " + type + ": " + entry.question);
      map.set(entry.question, entry.answer);
    }
    const numbers = [...map.keys()].sort((a, b) => a - b);
    if (numbers.length !== 80 || numbers.some((n, i) => n !== i + 1)) {
      issues.push("O gabarito do tipo " + type + " não contém exatamente as questões 1 a 80.");
      delete types[type];
      continue;
    }
    types[type] = numbers.map((question) => ({ question, answer: map.get(question) }));
  }
  return { types, issues };
}

export async function parseOabAnswerKeyPdf(file, pdfjs) {
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const first = await pdf.getPage(1);
  const rows = rowsFromPage(await first.getTextContent());
  const result = tableFromRows(rows);
  const firstPage = rows.map((row) => row.tokens.join(" ")).slice(0, 22).join(" ");
  const exam = firstPage.match(/(\d{1,3})\s*[º°ªo]?\s*EXAME\s+(?:DE\s+ORDEM\s+)?UNIFICADO/i);
  return { ...result, edition: exam ? String(Number(exam[1])) : null, typesAvailable: Object.keys(result.types).sort((a, b) => Number(a) - Number(b)), pages: pdf.numPages };
}

export function detectExamType(text) {
  const source = String(text || "");
  const matches = [...source.matchAll(/\b(?:PROVA|CADERNO)\s+(?:DE\s+)?(?:TIPO\s*)?([1-4])\b|\bTIPO\s*(?:DE\s+PROVA\s*)?([1-4])\b/gi)]
    .map((match) => String(Number(match[1] || match[2])));
  const found = [...new Set(matches)];
  return found.length === 1 ? found[0] : null;
}

export function formatAnswerKey(entries) {
  return [...entries].sort((a, b) => a.question - b.question)
    .map(({ question, answer }) => question + "-" + answer).join(", ");
}
