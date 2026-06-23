import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const artifactsDir = path.join(root, "artifacts");
const outFile = path.join(__dirname, "data.js");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      value += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(value);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += ch;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  const headers = rows.shift();
  return rows.map((cells) => Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""])));
}

async function readCsv(file) {
  return parseCsv(await fs.readFile(path.join(dataDir, file), "utf8"));
}

async function readIfExists(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function caseArtifacts(cases) {
  const artifactMap = {};
  for (const c of cases) {
    const dir = path.join(artifactsDir, "cases", c.case_id);
    artifactMap[c.case_id] = {
      chat: await readIfExists(path.join(dir, "chat_transcript.md")),
      email: await readIfExists(path.join(dir, "email_thread.md")),
      callNotes: await readIfExists(path.join(dir, "call_notes.md")),
      caseNotes: await readIfExists(path.join(dir, "case_notes.md")),
      statement: await readIfExists(path.join(dir, "statement_snippet.md")),
      responseTemplate: await readIfExists(path.join(dir, "agent_response_template.md")),
      accountScreenshot: await readIfExists(path.join(dir, "simple_account_screenshot.html")),
    };
  }
  return artifactMap;
}

async function kbDocuments(kbArticles) {
  const docs = {};
  const files = await fs.readdir(path.join(artifactsDir, "knowledge_base"));
  for (const article of kbArticles) {
    const file = files.find((name) => name.startsWith(`${article.article_id}_`));
    docs[article.article_id] = file
      ? await fs.readFile(path.join(artifactsDir, "knowledge_base", file), "utf8")
      : "";
  }
  return docs;
}

async function main() {
  const customers = await readCsv("customers.csv");
  const accounts = await readCsv("accounts.csv");
  const transactions = await readCsv("transactions.csv");
  const cases = await readCsv("customer_service_cases.csv");
  const kbArticles = await readCsv("knowledge_base_articles.csv");
  const goldenTests = await readCsv("golden_answer_tests.csv");
  const artifacts = await caseArtifacts(cases);
  const kbDocs = await kbDocuments(kbArticles);
  const payload = {
    generatedAt: new Date().toISOString(),
    customers,
    accounts,
    transactions,
    cases,
    kbArticles,
    goldenTests,
    artifacts,
    kbDocs,
  };
  await fs.writeFile(
    outFile,
    `window.CRM_DATA = ${JSON.stringify(payload, null, 2)};\n`,
    "utf8",
  );
  console.log(`Wrote ${outFile}`);
}

await main();
