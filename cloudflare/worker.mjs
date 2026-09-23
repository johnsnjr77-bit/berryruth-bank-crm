const RAW_BASE = "https://raw.githubusercontent.com/johnsnjr77-bit/berryruth-bank-crm/9184f84254f5d3727d1b8566b143a81d7a9ba5c2/crm_app";
const CASE_PATTERN = /^CASE-\d{5}$/;

const ASSETS = new Map([
  ["/", { file: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", contentType: "text/css; charset=utf-8" }],
  ["/app.js", { file: "app.js", contentType: "text/javascript; charset=utf-8" }],
  ["/data.js", { file: "data.js", contentType: "text/javascript; charset=utf-8" }],
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Cache-Control": "no-store",
    },
  });
}

function text(body, status = 200, contentType = "text/plain; charset=utf-8") {
  return new Response(body, {
    status,
    headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
  });
}

async function serveAsset(pathname) {
  const asset = ASSETS.get(pathname);
  if (!asset) return null;

  const upstream = await fetch(`${RAW_BASE}/${asset.file}`, {
    cf: { cacheTtl: 60, cacheEverything: true },
  });

  if (!upstream.ok) return text("Asset not found", 404);

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "public, max-age=60",
    },
  });
}

async function listRecommendations(env) {
  const list = await env.RECOMMENDATIONS.list({ prefix: "recommendation:" });
  const recommendations = {};

  await Promise.all(
    list.keys.map(async (key) => {
      const record = await env.RECOMMENDATIONS.get(key.name, { type: "json" });
      if (record?.caseId) recommendations[record.caseId] = record;
    }),
  );

  return recommendations;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.status = 400;
    throw error;
  }
}

async function handleApi(request, env, url) {
  if (request.method === "OPTIONS") return json({}, 204);

  if (url.pathname === "/api/health" && request.method === "GET") {
    return json({
      ok: true,
      service: "BerryRuth recommendation API",
      storage: "Cloudflare KV",
    });
  }

  if (url.pathname === "/api/recommendations" && request.method === "GET") {
    return json({ recommendations: await listRecommendations(env) });
  }

  const match = url.pathname.match(/^\/api\/cases\/(CASE-\d{5})\/recommendation$/);
  if (!match) return json({ error: "API route not found" }, 404);

  const caseId = match[1];
  if (!CASE_PATTERN.test(caseId)) return json({ error: "Invalid case_id", caseId }, 400);

  const key = `recommendation:${caseId}`;

  if (request.method === "GET") {
    const recommendation = await env.RECOMMENDATIONS.get(key, { type: "json" });
    if (!recommendation) return json({ error: "No recommendation found", caseId }, 404);
    return json({ recommendation });
  }

  if (request.method === "POST" || request.method === "PUT") {
    const body = await readJson(request);
    const recommendationText = String(body.recommendation || "").trim();
    if (!recommendationText) return json({ error: "Field 'recommendation' is required" }, 400);

    const previous = await env.RECOMMENDATIONS.get(key, { type: "json" });
    const now = new Date().toISOString();
    const record = {
      caseId,
      source: body.source ? String(body.source) : "UiPath Agent",
      status: body.status ? String(body.status) : "Draft",
      recommendation: recommendationText,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    };

    await env.RECOMMENDATIONS.put(key, JSON.stringify(record));
    return json({ recommendation: record }, request.method === "POST" ? 201 : 200);
  }

  if (request.method === "DELETE") {
    await env.RECOMMENDATIONS.delete(key);
    return json({ deleted: true, caseId });
  }

  return json({ error: "Method not allowed" }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, url);

      const asset = await serveAsset(url.pathname);
      if (asset) return asset;

      return text("Not found", 404);
    } catch (error) {
      return json({ error: error.message || "Internal server error" }, error.status || 500);
    }
  },
};
