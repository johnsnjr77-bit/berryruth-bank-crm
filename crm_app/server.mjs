import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const STORE_FILE = path.join(__dirname, "agent_recommendations.json");
const DATA_FILE = path.join(__dirname, "data.js");
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

let knownCaseIds;
async function getKnownCaseIds() {
  if (knownCaseIds) return knownCaseIds;
  const dataText = await fs.readFile(DATA_FILE, "utf8");
  knownCaseIds = new Set([...dataText.matchAll(/"case_id":\s*"(CASE-\d{5})"/g)].map((match) => match[1]));
  return knownCaseIds;
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
