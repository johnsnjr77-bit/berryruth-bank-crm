const data = window.CRM_DATA;

const state = {
  view: "cases",
  query: "",
  category: "All categories",
  status: "All statuses",
  priority: "All priorities",
  selectedCaseId: data.cases[0]?.case_id,
  selectedArtifact: "caseNotes",
  selectedCustomerId: data.customers[0]?.customer_id,
  selectedKbId: data.kbArticles[0]?.article_id,
};

const byId = {
  customer: new Map(data.customers.map((row) => [row.customer_id, row])),
  account: new Map(data.accounts.map((row) => [row.account_id, row])),
  transaction: new Map(data.transactions.map((row) => [row.transaction_id, row])),
  kb: new Map(data.kbArticles.map((row) => [row.article_id, row])),
};

const RECOMMENDATION_STORAGE_KEY = "berryruthAgentRecommendations";
const agentRecommendations = loadAgentRecommendations();
let recommendationApiAvailable = false;

const money = (value) => {
  if (value === "" || value === undefined) return "-";
  return Number(value).toLocaleString("en-US", { style: "currency", currency: "USD" });
};

const titleCase = (text) => text.replace(/\b\w/g, (letter) => letter.toUpperCase());
const normalize = (text) => String(text ?? "").toLowerCase();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function badge(text) {
  const cls = normalize(text).replace(/\s+/g, "-");
  return `<span class="badge ${cls.includes("urgent") ? "urgent" : ""} ${cls.includes("high") ? "high" : ""} ${cls.includes("escalated") ? "escalated" : ""} ${cls.includes("waiting") ? "waiting" : ""} ${cls.includes("progress") ? "progress" : ""} ${cls.includes("new") ? "new" : ""}">${text}</span>`;
}

function matchesQuery(row, extra = []) {
  if (!state.query) return true;
  const haystack = [...Object.values(row), ...extra].map(normalize).join(" ");
  return haystack.includes(normalize(state.query));
}

function hydrateCase(c) {
  const customer = byId.customer.get(c.customer_id) ?? {};
  const account = byId.account.get(c.account_id) ?? {};
  const transaction = byId.transaction.get(c.related_transaction_id) ?? {};
  const kb = byId.kb.get(c.kb_article_id) ?? {};
  return { ...c, customer, account, transaction, kb };
}

function loadAgentRecommendations() {
  try {
    return JSON.parse(localStorage.getItem(RECOMMENDATION_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function persistAgentRecommendations() {
  localStorage.setItem(RECOMMENDATION_STORAGE_KEY, JSON.stringify(agentRecommendations));
}

async function hydrateAgentRecommendationsFromApi() {
  try {
    const response = await fetch("/api/recommendations", { cache: "no-store" });
    if (!response.ok) throw new Error("Recommendation API unavailable");
    const payload = await response.json();
    Object.keys(agentRecommendations).forEach((key) => delete agentRecommendations[key]);
    Object.assign(agentRecommendations, payload.recommendations || {});
    recommendationApiAvailable = true;
    persistAgentRecommendations();
  } catch {
    recommendationApiAvailable = false;
  }
}

async function saveAgentRecommendation(caseId, recommendation) {
  const fallbackRecord = {
    caseId,
    source: "UiPath Agent",
    recommendation,
    updatedAt: new Date().toLocaleString(),
  };
  if (recommendationApiAvailable) {
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/recommendation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendation, source: "UiPath Agent" }),
      });
      if (!response.ok) throw new Error("Save failed");
      const payload = await response.json();
      agentRecommendations[caseId] = payload.recommendation;
      persistAgentRecommendations();
      return;
    } catch {
      recommendationApiAvailable = false;
    }
  }
  agentRecommendations[caseId] = fallbackRecord;
  persistAgentRecommendations();
}

async function clearAgentRecommendation(caseId) {
  if (recommendationApiAvailable) {
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/recommendation`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404) throw new Error("Delete failed");
    } catch {
      recommendationApiAvailable = false;
    }
  }
  delete agentRecommendations[caseId];
  persistAgentRecommendations();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"'`]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
    "`": "&#96;",
  }[char]));
}

function renderSummary() {
  const openCases = data.cases.filter((c) => !["Resolved"].includes(c.status)).length;
  const urgent = data.cases.filter((c) => c.priority === "Urgent" || c.status === "Escalated").length;
  const cards = [
    ["Customers", data.customers.length],
    ["Accounts", data.accounts.length],
    ["Transactions", data.transactions.length.toLocaleString()],
    ["Cases", data.cases.length],
    ["Open or escalated", openCases],
    ["High attention", urgent],
  ];
  const root = document.getElementById("summaryCards");
  root.replaceChildren(...cards.map(([label, value]) => {
    const card = el("div", "summary-card");
    card.innerHTML = `<div class="value">${value}</div><div class="label">${label}</div>`;
    return card;
  }));
}

function populateFilters() {
  const selectOptions = (id, values, current) => {
    const select = document.getElementById(id);
    select.replaceChildren(...values.map((value) => {
      const option = el("option", "", value);
      option.value = value;
      option.selected = value === current;
      return option;
    }));
  };
  selectOptions("categoryFilter", ["All categories", ...new Set(data.cases.map((c) => c.category))], state.category);
  selectOptions("statusFilter", ["All statuses", ...new Set(data.cases.map((c) => c.status))], state.status);
  selectOptions("priorityFilter", ["All priorities", ...new Set(data.cases.map((c) => c.priority))], state.priority);
}

function filteredCases() {
  return data.cases.filter((c) => {
    if (state.category !== "All categories" && c.category !== state.category) return false;
    if (state.status !== "All statuses" && c.status !== state.status) return false;
    if (state.priority !== "All priorities" && c.priority !== state.priority) return false;
    const h = hydrateCase(c);
    return matchesQuery(c, [
      h.customer.full_name,
      h.customer.email,
      h.account.masked_account_number,
      h.transaction.description,
      h.kb.title,
    ]);
  });
}

function renderCases() {
  const rows = filteredCases();
  if (!rows.some((c) => c.case_id === state.selectedCaseId)) {
    state.selectedCaseId = rows[0]?.case_id ?? data.cases[0]?.case_id;
  }
  document.getElementById("caseCount").textContent = `${rows.length} visible`;
  const list = document.getElementById("caseList");
  if (!rows.length) {
    list.innerHTML = `<div class="empty">No cases match the current filters.</div>`;
    return;
  }
  list.replaceChildren(...rows.map((c) => {
    const h = hydrateCase(c);
    const row = el("button", `case-row ${c.case_id === state.selectedCaseId ? "active" : ""}`);
    row.type = "button";
    row.innerHTML = `
      <div class="row-top">
        <span class="case-id">${c.case_id}</span>
        ${badge(c.priority)}
      </div>
      <div class="case-title">${titleCase(c.category)} for ${h.customer.full_name ?? c.customer_id}</div>
      <div class="inline">
        ${badge(c.status)}
        <span class="meta">${c.channel} · ${c.assigned_queue}</span>
      </div>
    `;
    row.addEventListener("click", () => {
      state.selectedCaseId = c.case_id;
      state.selectedArtifact = "caseNotes";
      renderCases();
      renderCaseDetail();
    });
    return row;
  }));
}

function renderKv(entries) {
  return `<dl class="kv">${entries.map(([k, v]) => `<dt>${k}</dt><dd>${v === "" || v === undefined || v === null ? "-" : v}</dd>`).join("")}</dl>`;
}

function recentTransactions(accountId, limit = 6) {
  return data.transactions
    .filter((t) => t.account_id === accountId)
    .slice(0, limit);
}

function buildCopilot(c) {
  const h = hydrateCase(c);
  return `Recommended response:

Hi ${h.customer.first_name},

Thanks for contacting us about ${c.category}. I reviewed the case details for your account ending in ${h.account.masked_account_number} and the related reference ${h.transaction.reference_number}. Based on ${h.kb.title}, the next step is to ${c.requested_action.charAt(0).toLowerCase() + c.requested_action.slice(1)}

Policy checks:
- Confirm identity before discussing account-specific details.
- Use ${c.kb_article_id} for the category-specific procedure.
- Keep account and card identifiers masked.
- Do not guarantee outcomes before the assigned queue completes review.

Suggested internal action:
Route to ${c.assigned_queue}, attach ${c.related_transaction_id}, and set follow-up based on ${c.priority} priority.`;
}

function renderCaseDetail() {
  const c = data.cases.find((row) => row.case_id === state.selectedCaseId);
  const root = document.getElementById("caseDetail");
  if (!c) {
    root.innerHTML = `<div class="empty">Select a case to view details.</div>`;
    return;
  }
  const h = hydrateCase(c);
  const artifacts = data.artifacts[c.case_id] ?? {};
  const artifactLabels = [
    ["caseNotes", "Case Notes"],
    ["chat", "Chat"],
    ["email", "Email"],
    ["callNotes", "Call Notes"],
    ["statement", "Statement"],
    ["responseTemplate", "Template"],
    ["accountScreenshot", "Screenshot"],
  ];
  const transactions = recentTransactions(c.account_id);
  const savedRecommendation = agentRecommendations[c.case_id];
  const recommendationText = savedRecommendation?.recommendation || (c.status === "Resolved" ? buildCopilot(c) : "");
  const recommendationMeta = savedRecommendation
    ? `Saved from ${savedRecommendation.source} at ${savedRecommendation.updatedAt}`
    : c.status === "Resolved"
      ? "Resolved-case example recommendation"
      : "No recommendation saved yet";
  const recommendationMode = recommendationApiAvailable ? "API-backed" : "Local draft";
  const recommendationSection = `
      <div class="section recommendation-editor">
        <div class="section-title-row">
          <h3>Agent Recommendation</h3>
          <span class="meta">${recommendationMeta} · ${recommendationMode}</span>
        </div>
        <div class="section-body">
          <textarea id="agentRecommendationText" class="recommendation-input" placeholder="Paste the UiPath Agent recommendation for this case here.">${escapeHtml(recommendationText)}</textarea>
          <div class="recommendation-actions">
            <button class="action-button" id="saveRecommendation" type="button">Save Recommendation</button>
            <button class="ghost-button" id="clearRecommendation" type="button">Clear</button>
          </div>
        </div>
      </div>`;
  root.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>${c.case_id} · ${titleCase(c.category)}</h2>
        <div class="inline">
          ${badge(c.status)}
          ${badge(c.priority)}
          <span class="meta">${c.opened_at} · ${c.assigned_queue}</span>
        </div>
      </div>
      <div class="detail-actions">
        <button class="action-button" id="mockResolve" type="button">Mark Reviewed</button>
      </div>
    </div>
    <div class="detail-grid">
      ${recommendationSection}
      <div class="section">
        <h3>Case Metadata</h3>
        <div class="section-body">
          ${renderKv([
            ["Customer", `${h.customer.full_name} (${c.customer_id})`],
            ["Account", `${h.account.account_type} ${h.account.masked_account_number}`],
            ["Related item", `${h.transaction.description} (${h.transaction.status})`],
            ["KB article", `${c.kb_article_id} · ${h.kb.title}`],
            ["Sentiment", c.customer_sentiment],
          ])}
        </div>
      </div>
      <div class="section">
        <h3>Evidence</h3>
        <div class="tabs">
          ${artifactLabels.map(([key, label]) => `<button class="tab ${state.selectedArtifact === key ? "active" : ""}" data-artifact="${key}" type="button">${label}</button>`).join("")}
        </div>
        <div id="artifactContent"></div>
      </div>
      <div class="section">
        <h3>Recent Account Activity</h3>
        <div class="section-body">
          <table class="mini-table">
            <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              ${transactions.map((t) => `<tr><td>${t.transaction_date}</td><td>${t.description}</td><td>${money(t.amount)}</td><td>${t.status}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  root.querySelectorAll("[data-artifact]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedArtifact = button.dataset.artifact;
      renderCaseDetail();
    });
  });
  root.querySelector("#mockResolve").addEventListener("click", () => {
    root.querySelector("#mockResolve").textContent = "Reviewed";
    root.querySelector("#mockResolve").disabled = true;
  });
  root.querySelector("#saveRecommendation").addEventListener("click", async () => {
    const button = root.querySelector("#saveRecommendation");
    const text = root.querySelector("#agentRecommendationText").value.trim();
    if (!text) return;
    button.textContent = "Saving...";
    button.disabled = true;
    await saveAgentRecommendation(c.case_id, text);
    renderCaseDetail();
  });
  root.querySelector("#clearRecommendation").addEventListener("click", async () => {
    await clearAgentRecommendation(c.case_id);
    renderCaseDetail();
  });
  const content = root.querySelector("#artifactContent");
  if (state.selectedArtifact === "accountScreenshot") {
    content.innerHTML = `<iframe class="screenshot-frame" title="Synthetic account screenshot" sandbox srcdoc="${artifacts.accountScreenshot.replaceAll('"', "&quot;")}"></iframe>`;
  } else {
    const box = el("div", "artifact-box");
    box.textContent = artifacts[state.selectedArtifact] || "No artifact found for this case.";
    content.replaceChildren(box);
  }
}

function renderTable(rootId, rows, cols, onSelect, activeId) {
  const root = document.getElementById(rootId);
  const table = el("table");
  const thead = el("thead");
  thead.innerHTML = `<tr>${cols.map((c) => `<th>${c.label}</th>`).join("")}</tr>`;
  const tbody = el("tbody");
  rows.forEach((row) => {
    const tr = el("tr", row[cols[0].key] === activeId ? "active" : "");
    tr.innerHTML = cols.map((c) => `<td>${c.render ? c.render(row) : row[c.key]}</td>`).join("");
    tr.addEventListener("click", () => onSelect?.(row));
    tbody.appendChild(tr);
  });
  table.append(thead, tbody);
  root.replaceChildren(table);
}

function renderCustomers() {
  const rows = data.customers.filter((c) => matchesQuery(c));
  document.getElementById("customerCount").textContent = `${rows.length} visible`;
  renderTable("customerTable", rows.slice(0, 200), [
    { key: "customer_id", label: "Customer ID" },
    { key: "full_name", label: "Name" },
    { key: "segment", label: "Segment" },
    { key: "preferred_contact", label: "Contact" },
    { key: "state", label: "State" },
  ], (row) => {
    state.selectedCustomerId = row.customer_id;
    renderCustomers();
  }, state.selectedCustomerId);
  renderCustomerDetail();
}

function renderCustomerDetail() {
  const customer = byId.customer.get(state.selectedCustomerId);
  const root = document.getElementById("customerDetail");
  if (!customer) {
    root.innerHTML = `<div class="empty">Select a customer.</div>`;
    return;
  }
  const accounts = data.accounts.filter((a) => a.customer_id === customer.customer_id);
  const cases = data.cases.filter((c) => c.customer_id === customer.customer_id);
  root.innerHTML = `
    <div class="section">
      <h3>Profile</h3>
      <div class="section-body">
        ${renderKv([
          ["Name", customer.full_name],
          ["Email", customer.email],
          ["Phone", customer.phone],
          ["Address", `${customer.street_address}, ${customer.city}, ${customer.state} ${customer.zip}`],
          ["Segment", customer.segment],
          ["Since", customer.customer_since],
        ])}
      </div>
    </div>
    <div class="section">
      <h3>Accounts</h3>
      <div class="section-body">
        <table class="mini-table">
          <thead><tr><th>Account</th><th>Type</th><th>Balance</th><th>Status</th></tr></thead>
          <tbody>${accounts.map((a) => `<tr><td>${a.masked_account_number}</td><td>${a.account_type}</td><td>${money(a.current_balance)}</td><td>${a.status}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </div>
    <div class="section">
      <h3>Cases</h3>
      <div class="section-body">
        <table class="mini-table">
          <tbody>${cases.map((c) => `<tr><td>${c.case_id}</td><td>${titleCase(c.category)}</td><td>${c.status}</td></tr>`).join("") || `<tr><td>No cases</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderKnowledge() {
  const rows = data.kbArticles.filter((kb) => matchesQuery(kb, [data.kbDocs[kb.article_id]]));
  document.getElementById("kbCount").textContent = `${rows.length} visible`;
  renderTable("kbTable", rows, [
    { key: "article_id", label: "Article" },
    { key: "category", label: "Category", render: (row) => titleCase(row.category) },
    { key: "title", label: "Title" },
    { key: "audience", label: "Audience" },
    { key: "last_reviewed", label: "Reviewed" },
  ], (row) => {
    state.selectedKbId = row.article_id;
    renderKnowledge();
  }, state.selectedKbId);
  const detail = document.getElementById("kbDetail");
  detail.textContent = data.kbDocs[state.selectedKbId] || "Select an article to preview it.";
}

function renderTests() {
  const rows = data.goldenTests.filter((test) => matchesQuery(test));
  document.getElementById("testCount").textContent = `${rows.length} visible`;
  renderTable("testTable", rows, [
    { key: "test_id", label: "Test" },
    { key: "case_id", label: "Case" },
    { key: "category", label: "Category", render: (row) => titleCase(row.category) },
    { key: "user_question", label: "Prompt" },
    { key: "must_include", label: "Must Include" },
    { key: "must_not_include", label: "Must Not Include" },
  ]);
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    acc[row[key]] = (acc[row[key]] || 0) + 1;
    return acc;
  }, {});
}

function renderBars(title, counts) {
  const max = Math.max(...Object.values(counts));
  return `
    <div class="health-card">
      <h2>${title}</h2>
      ${Object.entries(counts).map(([label, value]) => `
        <div class="bar">
          <span>${titleCase(label)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(value / max) * 100}%"></div></div>
          <strong>${value}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderHealth() {
  const accountJoinMisses = data.accounts.filter((a) => !byId.customer.has(a.customer_id)).length;
  const caseCustomerMisses = data.cases.filter((c) => !byId.customer.has(c.customer_id)).length;
  const caseAccountMisses = data.cases.filter((c) => !byId.account.has(c.account_id)).length;
  const caseTxnMisses = data.cases.filter((c) => !byId.transaction.has(c.related_transaction_id)).length;
  document.getElementById("healthGrid").innerHTML = `
    ${renderBars("Cases by Category", countBy(data.cases, "category"))}
    ${renderBars("Cases by Status", countBy(data.cases, "status"))}
    ${renderBars("Cases by Channel", countBy(data.cases, "channel"))}
    <div class="health-card">
      <h2>Referential Checks</h2>
      ${renderKv([
        ["Account customer misses", accountJoinMisses],
        ["Case customer misses", caseCustomerMisses],
        ["Case account misses", caseAccountMisses],
        ["Case transaction misses", caseTxnMisses],
        ["Artifact folders", Object.keys(data.artifacts).length],
      ])}
    </div>
  `;
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  document.querySelectorAll(".view").forEach((panel) => panel.classList.toggle("active", panel.id === `${view}View`));
  renderActiveView();
}

function renderActiveView() {
  renderSummary();
  if (state.view === "cases") {
    renderCases();
    renderCaseDetail();
  }
  if (state.view === "customers") renderCustomers();
  if (state.view === "knowledge") renderKnowledge();
  if (state.view === "tests") renderTests();
  if (state.view === "health") renderHealth();
}

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  document.getElementById("globalSearch").addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    renderActiveView();
  });
  document.getElementById("categoryFilter").addEventListener("change", (event) => {
    state.category = event.target.value;
    renderCases();
    renderCaseDetail();
  });
  document.getElementById("statusFilter").addEventListener("change", (event) => {
    state.status = event.target.value;
    renderCases();
    renderCaseDetail();
  });
  document.getElementById("priorityFilter").addEventListener("change", (event) => {
    state.priority = event.target.value;
    renderCases();
    renderCaseDetail();
  });
  document.getElementById("resetFilters").addEventListener("click", () => {
    state.query = "";
    state.category = "All categories";
    state.status = "All statuses";
    state.priority = "All priorities";
    document.getElementById("globalSearch").value = "";
    populateFilters();
    renderActiveView();
  });
}

async function initialize() {
  await hydrateAgentRecommendationsFromApi();
  populateFilters();
  bindEvents();
  renderActiveView();
}

initialize();
