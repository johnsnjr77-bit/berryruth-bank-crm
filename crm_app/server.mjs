import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const STORE_FILE = path.join(__dirname, "agent_recommendations.json");
const CASE_STORE_FILE = path.join(__dirname, "created_cases.json");
const ACCOUNT_STORE_FILE = path.join(__dirname, "created_accounts.json");
const DATA_FILE = path.join(__dirname, "data.js");
const LOAN_DOCS_DIR = path.resolve(__dirname, "..", "loan_origination_documents");
const LOAN_DOCS_MANIFEST = path.join(LOAN_DOCS_DIR, "manifest.json");
const MAX_BODY_BYTES = 1024 * 1024;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function send(res, status, body, headers = {}) {
  const isString = typeof body === "string";
  const payload = isString ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": isString ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    ...headers,
  });
  res.end(payload);
}

async function readStore() {
  try {
    const parsed = JSON.parse(await fs.readFile(STORE_FILE, "utf8"));
    return { recommendations: parsed.recommendations || {} };
  } catch {
    return { recommendations: {} };
  }
}

async function writeStore(store) {
  await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2) + "\n", "utf8");
}

async function readCaseStore() {
  try {
    const parsed = JSON.parse(await fs.readFile(CASE_STORE_FILE, "utf8"));
    return { cases: parsed.cases || [] };
  } catch {
    return { cases: [] };
  }
}

async function writeCaseStore(store) {
  await fs.writeFile(CASE_STORE_FILE, JSON.stringify(store, null, 2) + "\n", "utf8");
}

async function readAccountStore() {
  try {
    const parsed = JSON.parse(await fs.readFile(ACCOUNT_STORE_FILE, "utf8"));
    return { accounts: parsed.accounts || [] };
  } catch {
    return { accounts: [] };
  }
}

async function writeAccountStore(store) {
  await fs.writeFile(ACCOUNT_STORE_FILE, JSON.stringify(store, null, 2) + "\n", "utf8");
}

const ACCOUNT_TYPES = ["Checking", "Savings", "Money Market", "Credit Card", "Mortgage", "Auto Loan", "Personal Loan"];

function maskedAccountNumber(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length >= 4) return `****${digits.slice(-4)}`;
  return `****${String(Date.now()).slice(-4)}`;
}

function normalizeCreatedAccount(input) {
  const accountType = ACCOUNT_TYPES.includes(input.account_type) ? input.account_type : "Checking";
  const balance = input.current_balance === "" || input.current_balance === undefined ? "0" : String(input.current_balance);
  return {
    account_id: String(input.account_id || "").trim(),
    customer_id: String(input.customer_id || "").trim(),
    account_type: accountType,
    masked_account_number: maskedAccountNumber(input.masked_account_number || input.account_number),
    open_date: input.open_date || new Date().toISOString().slice(0, 10),
    status: String(input.status || "Open").trim(),
    current_balance: balance,
    available_balance: accountType === "Credit Card" || accountType === "Mortgage" ? "" : String(input.available_balance || balance),
    credit_limit: accountType === "Credit Card" ? String(input.credit_limit || "5000") : String(input.credit_limit || ""),
    apr: ["Credit Card", "Mortgage", "Auto Loan", "Personal Loan"].includes(accountType) ? String(input.apr || "") : "",
    branch_code: String(input.branch_code || "BR-CRM").trim(),
    synthetic_notice: "User-created sandbox account",
    source: input.source || "CRM",
  };
}

function normalizeCreatedCase(input) {
  const issueType = String(input.issue_type || input.category || "").trim();
  const owner = String(input.owner || input.assigned_queue || "").trim();
  return {
    case_id: String(input.case_id || "").trim(),
    issue_type: issueType,
    category: issueType,
    status: String(input.status || "New").trim(),
    owner,
    assigned_queue: owner,
    sla: String(input.sla || "").trim(),
    resolution: String(input.resolution || "").trim(),
    priority: String(input.priority || "Medium").trim(),
    channel: String(input.channel || "manual").trim(),
    opened_at: input.opened_at || new Date().toLocaleString(),
    short_summary: issueType ? `New ${issueType} case` : "New case",
    requested_action: "Review case details and determine next best action.",
    customer_sentiment: "Neutral",
    synthetic_notice: "User-created sandbox case",
    source: input.source || "CRM",
  };
}

let knownCaseIds;
async function getKnownCaseIds() {
  if (knownCaseIds) return knownCaseIds;
  const dataText = await fs.readFile(DATA_FILE, "utf8");
  knownCaseIds = new Set([...dataText.matchAll(/"case_id":\s*"(CASE-\d{5})"/g)].map((match) => match[1]));
  return knownCaseIds;
}

async function readLoanDocManifest() {
  const parsed = JSON.parse(await fs.readFile(LOAN_DOCS_MANIFEST, "utf8"));
  return parsed;
}

async function writeLoanDocManifest(manifest) {
  await fs.writeFile(LOAN_DOCS_MANIFEST, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  if (manifest.documents?.length) {
    const headers = Object.keys(manifest.documents[0]);
    const rows = manifest.documents.map((row) => headers.map((key) => csvEscape(row[key])).join(","));
    await fs.writeFile(path.join(LOAN_DOCS_DIR, "manifest.csv"), [headers.join(","), ...rows].join("\n") + "\n", "utf8");
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function slug(value) {
  return String(value || "document").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "document";
}

async function parseCrmData() {
  const text = await fs.readFile(DATA_FILE, "utf8");
  const prefix = "window.CRM_DATA = ";
  const jsonText = text.startsWith(prefix) ? text.slice(prefix.length).replace(/;\s*$/, "") : text;
  return JSON.parse(jsonText);
}

function stableNumber(seed) {
  return [...String(seed)].reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function riskTier(score) {
  if (score >= 740) return "Low";
  if (score >= 660) return "Moderate";
  return "High";
}

function nextLoanId(manifest) {
  const nums = (manifest.documents || [])
    .map((doc) => String(doc.loan_id || "").match(/^LOAN-(\\d{5})$/)?.[1])
    .filter(Boolean)
    .map(Number);
  return `LOAN-${String(Math.max(0, ...nums) + 1).padStart(5, "0")}`;
}

function normalizeNewLoanCustomer(input, crmCustomer) {
  const customerId = String(input.customer_id || crmCustomer?.customer_id || "").trim();
  const seed = stableNumber(customerId || input.customer_name || Date.now());
  const creditScore = Number(input.credit_score || crmCustomer?.credit_score || (580 + (seed % 260)));
  const fullName = String(input.customer_name || crmCustomer?.full_name || "").trim();
  return {
    customer_id: customerId,
    customer_name: fullName,
    email: String(input.email || crmCustomer?.email || "").trim(),
    phone: String(input.phone || crmCustomer?.phone || "").trim(),
    address: String(input.address || (crmCustomer ? `${crmCustomer.street_address}, ${crmCustomer.city}, ${crmCustomer.state} ${crmCustomer.zip}` : "")).trim(),
    household_id: String(input.household_id || crmCustomer?.household_id || `HH-${String(90000 + (seed % 9999)).slice(-5)}`).trim(),
    credit_score: creditScore,
    risk_tier: String(input.risk_tier || crmCustomer?.risk_tier || riskTier(creditScore)).trim(),
  };
}

function renderLoanApplicationDocument(record, input) {
  return renderCreatedLoanDocument(record, `| Field | Value |
| --- | --- |
| Application date | ${new Date().toISOString().slice(0, 10)} |
| Loan purpose | ${input.loan_purpose || "Primary residence purchase"} |
| Requested loan amount | ${input.loan_amount || "Pending"} |
| Purchase price | ${input.purchase_price || "Pending"} |
| Property address | ${input.property_address || record.address} |
| Status | New loan package |

This starter loan application was created from the BerryRuth Bank Loan Docs application.`);
}

async function createLoanPackage(input) {
  const manifest = await readLoanDocManifest();
  const crm = await parseCrmData();
  const requestedCustomerId = String(input.customer_id || "").trim();
  const crmCustomer = requestedCustomerId ? crm.customers.find((customer) => customer.customer_id === requestedCustomerId) : null;
  const customer = normalizeNewLoanCustomer(input, crmCustomer);
  if (!customer.customer_id) {
    const error = new Error("Field 'customer_id' is required");
    error.statusCode = 400;
    throw error;
  }
  if (!customer.customer_name) {
    const error = new Error("Customer name is required");
    error.statusCode = 400;
    throw error;
  }
  const loanId = String(input.loan_id || nextLoanId(manifest)).trim();
  if (manifest.documents.some((doc) => doc.loan_id === loanId)) {
    const error = new Error("loan_id already exists");
    error.statusCode = 409;
    throw error;
  }
  const record = {
    loan_id: loanId,
    customer_id: customer.customer_id,
    customer_name: customer.customer_name,
    email: customer.email,
    phone: customer.phone,
    address: customer.address,
    household_id: customer.household_id,
    credit_score: customer.credit_score,
    risk_tier: customer.risk_tier,
    document_type: "Loan application",
    document_key: "loan_application",
    demo_use: "Data extraction",
    relative_path: `packages/${loanId}_${customer.customer_id}/${loanId}_${customer.customer_id}_loan_application.md`,
  };
  await fs.mkdir(path.dirname(safeLoanDocPath(record.relative_path)), { recursive: true });
  await fs.writeFile(safeLoanDocPath(record.relative_path), renderLoanApplicationDocument(record, input), "utf8");
  manifest.documents.push(record);
  manifest.documentCount = manifest.documents.length;
  manifest.packageCount = new Set(manifest.documents.map((doc) => doc.loan_id)).size;
  manifest.generatedAt = new Date().toISOString();
  await writeLoanDocManifest(manifest);
  return record;
}

function renderCreatedLoanDocument(record, content) {
  return `---
loan_id: ${record.loan_id}
customer_id: ${record.customer_id}
document_type: ${record.document_type}
demo_use: ${record.demo_use}
synthetic_notice: Synthetic BerryRuth Bank document for testing only; no real customer data.
---

# ${record.document_type}

Demo use: ${record.demo_use}

## Customer Match Fields

| Field | Value |
| --- | --- |
| Customer ID | ${record.customer_id} |
| Full name | ${record.customer_name} |
| Email | ${record.email} |
| Phone | ${record.phone} |
| Address | ${record.address} |
| Household ID | ${record.household_id} |
| Credit score | ${record.credit_score} |
| Risk tier | ${record.risk_tier} |

## Document Details

${content}

## Repository Notes

This document was added from the BerryRuth Bank Loan Docs application.
`;
}

async function createLoanDocument(input) {
  const manifest = await readLoanDocManifest();
  const loanId = String(input.loan_id || "").trim();
  const packageDocs = manifest.documents.filter((doc) => doc.loan_id === loanId);
  if (!packageDocs.length) {
    const error = new Error("Unknown loan_id");
    error.statusCode = 404;
    throw error;
  }
  const base = packageDocs[0];
  const documentType = String(input.document_type || "").trim();
  const demoUse = String(input.demo_use || "").trim();
  const details = String(input.details || "").trim();
  if (!documentType) {
    const error = new Error("Field 'document_type' is required");
    error.statusCode = 400;
    throw error;
  }
  if (!demoUse) {
    const error = new Error("Field 'demo_use' is required");
    error.statusCode = 400;
    throw error;
  }
  if (!details) {
    const error = new Error("Field 'details' is required");
    error.statusCode = 400;
    throw error;
  }
  const documentKeyBase = slug(input.document_key || documentType);
  let documentKey = documentKeyBase;
  let counter = 1;
  while (manifest.documents.some((doc) => doc.loan_id === loanId && doc.document_key === documentKey)) {
    counter += 1;
    documentKey = `${documentKeyBase}_${counter}`;
  }
  const folder = path.dirname(safeLoanDocPath(base.relative_path));
  const filename = `${loanId}_${base.customer_id}_${documentKey}.md`;
  const relativePath = path.relative(LOAN_DOCS_DIR, path.join(folder, filename));
  const record = {
    loan_id: loanId,
    customer_id: base.customer_id,
    customer_name: base.customer_name,
    email: base.email,
    phone: base.phone,
    address: base.address,
    household_id: base.household_id,
    credit_score: base.credit_score,
    risk_tier: base.risk_tier,
    document_type: documentType,
    document_key: documentKey,
    demo_use: demoUse,
    relative_path: relativePath,
  };
  await fs.writeFile(safeLoanDocPath(relativePath), renderCreatedLoanDocument(record, details), "utf8");
  manifest.documents.push(record);
  manifest.documentCount = manifest.documents.length;
  manifest.packageCount = new Set(manifest.documents.map((doc) => doc.loan_id)).size;
  manifest.generatedAt = new Date().toISOString();
  await writeLoanDocManifest(manifest);
  return record;
}

function safeLoanDocPath(relativePath) {
  const resolved = path.resolve(LOAN_DOCS_DIR, relativePath || "");
  if (!resolved.startsWith(LOAN_DOCS_DIR + path.sep)) {
    const error = new Error("Invalid document path");
    error.statusCode = 400;
    throw error;
  }
  return resolved;
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.statusCode = 400;
    throw error;
  }
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") return send(res, 204, "");
  if (url.pathname === "/api/health" && req.method === "GET") {
    return send(res, 200, { ok: true, service: "BerryRuth recommendation API" });
  }
  if (url.pathname === "/api/recommendations" && req.method === "GET") {
    return send(res, 200, await readStore());
  }
  if (url.pathname === "/api/loan-documents" && req.method === "GET") {
    return send(res, 200, await readLoanDocManifest());
  }
  if (url.pathname === "/api/loans" && req.method === "POST") {
    const body = await readJsonBody(req);
    const loan = await createLoanPackage(body);
    return send(res, 201, { loan });
  }
  if (url.pathname === "/api/loan-documents" && req.method === "POST") {
    const body = await readJsonBody(req);
    const document = await createLoanDocument(body);
    return send(res, 201, { document });
  }
  if (url.pathname === "/api/loan-documents/content" && req.method === "GET") {
    const relativePath = url.searchParams.get("path");
    const filePath = safeLoanDocPath(relativePath);
    const content = await fs.readFile(filePath, "utf8");
    return send(res, 200, { relativePath, content });
  }
  if (url.pathname === "/api/accounts" && req.method === "GET") {
    return send(res, 200, await readAccountStore());
  }
  if (url.pathname === "/api/accounts" && req.method === "POST") {
    const body = await readJsonBody(req);
    const record = normalizeCreatedAccount(body);
    if (!record.account_id) return send(res, 400, { error: "Field 'account_id' is required" });
    if (!record.customer_id) return send(res, 400, { error: "Field 'customer_id' is required" });
    if (!record.account_type) return send(res, 400, { error: "Field 'account_type' is required" });
    if (!record.masked_account_number) return send(res, 400, { error: "Field 'masked_account_number' is required" });
    const store = await readAccountStore();
    const existing = store.accounts.findIndex((a) => a.account_id === record.account_id);
    if (existing >= 0) store.accounts[existing] = { ...store.accounts[existing], ...record };
    else store.accounts.unshift(record);
    await writeAccountStore(store);
    return send(res, existing >= 0 ? 200 : 201, { account: record });
  }
  if (url.pathname === "/api/cases" && req.method === "GET") {
    return send(res, 200, await readCaseStore());
  }
  if (url.pathname === "/api/cases" && req.method === "POST") {
    const body = await readJsonBody(req);
    const record = normalizeCreatedCase(body);
    if (!record.case_id) return send(res, 400, { error: "Field 'case_id' is required" });
    if (!record.issue_type) return send(res, 400, { error: "Field 'issue_type' is required" });
    if (!record.owner) return send(res, 400, { error: "Field 'owner' is required" });
    if (!record.sla) return send(res, 400, { error: "Field 'sla' is required" });
    const store = await readCaseStore();
    const existing = store.cases.findIndex((c) => c.case_id === record.case_id);
    if (existing >= 0) store.cases[existing] = { ...store.cases[existing], ...record };
    else store.cases.unshift(record);
    await writeCaseStore(store);
    return send(res, existing >= 0 ? 200 : 201, { case: record });
  }

  const match = url.pathname.match(/^\/api\/cases\/(CASE-\d{5})\/recommendation$/);
  if (!match) return send(res, 404, { error: "API route not found" });

  const caseId = match[1];
  const knownCases = await getKnownCaseIds();
  if (!knownCases.has(caseId)) return send(res, 404, { error: "Unknown case_id", caseId });

  const store = await readStore();
  if (req.method === "GET") {
    const recommendation = store.recommendations[caseId];
    if (!recommendation) return send(res, 404, { error: "No recommendation found", caseId });
    return send(res, 200, { recommendation });
  }

  if (req.method === "POST" || req.method === "PUT") {
    const body = await readJsonBody(req);
    const recommendationText = String(body.recommendation || "").trim();
    if (!recommendationText) {
      return send(res, 400, { error: "Field 'recommendation' is required" });
    }
    const now = new Date().toISOString();
    const record = {
      caseId,
      source: body.source ? String(body.source) : "UiPath Agent",
      status: body.status ? String(body.status) : "Draft",
      recommendation: recommendationText,
      createdAt: store.recommendations[caseId]?.createdAt || now,
      updatedAt: now,
    };
    store.recommendations[caseId] = record;
    await writeStore(store);
    return send(res, req.method === "POST" ? 201 : 200, { recommendation: record });
  }

  if (req.method === "DELETE") {
    delete store.recommendations[caseId];
    await writeStore(store);
    return send(res, 200, { deleted: true, caseId });
  }

  return send(res, 405, { error: "Method not allowed" });
}

async function handleStatic(req, res, url) {
  const rawPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(__dirname, rawPath));
  if (!filePath.startsWith(__dirname)) return send(res, 403, "Forbidden");
  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(file);
  } catch {
    send(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      await handleStatic(req, res, url);
    }
  } catch (error) {
    send(res, error.statusCode || 500, { error: error.message || "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`BerryRuth CRM listening at http://${HOST}:${PORT}/`);
});
