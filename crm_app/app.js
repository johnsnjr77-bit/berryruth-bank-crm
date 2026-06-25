const data = window.CRM_DATA;

const state = {
  view: "cases",
  query: "",
  category: "All categories",
  status: "All statuses",
  priority: "All priorities",
  selectedCaseId: data.cases[0]?.case_id,
  selectedArtifact: "caseNotes",
  isCreatingCase: false,
  isCreatingAccount: false,
  selectedCustomerId: data.customers[0]?.customer_id,
  selectedKbId: data.kbArticles[0]?.article_id,
  loanDocs: [],
  loanPackages: [],
  selectedLoanId: null,
  selectedLoanDocPath: null,
  loanDocType: "All document types",
  loanDocPreview: "Select a loan document to preview it.",
  isCreatingLoanDoc: false,
  isCreatingLoan: false,
};

const ACCOUNT_TYPES = ["Checking", "Savings", "Money Market", "Credit Card", "Mortgage", "Auto Loan", "Personal Loan"];

enrichSyntheticData();

const byId = {
  customer: new Map(data.customers.map((row) => [row.customer_id, row])),
  account: new Map(data.accounts.map((row) => [row.account_id, row])),
  transaction: new Map(data.transactions.map((row) => [row.transaction_id, row])),
  kb: new Map(data.kbArticles.map((row) => [row.article_id, row])),
};

const RECOMMENDATION_STORAGE_KEY = "berryruthAgentRecommendations";
const ACCOUNT_STORAGE_KEY = "berryruthCreatedAccounts";
const agentRecommendations = loadAgentRecommendations();
let recommendationApiAvailable = false;
let caseApiAvailable = false;
let accountApiAvailable = false;

const money = (value) => {
  if (value === "" || value === undefined) return "-";
  return Number(value).toLocaleString("en-US", { style: "currency", currency: "USD" });
};

const titleCase = (text) => String(text || "").replace(/\b\w/g, (letter) => letter.toUpperCase());
const normalize = (text) => String(text ?? "").toLowerCase();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function stableNumber(seed) {
  return [...String(seed)].reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function riskTier(score) {
  if (score >= 740) return "Low";
  if (score >= 660) return "Moderate";
  return "High";
}

function enrichSyntheticData() {
  data.customers.forEach((customer, index) => {
    const seed = stableNumber(customer.customer_id);
    const householdNumber = Math.floor(index / 2) + 1;
    const creditScore = 580 + (seed % 260);
    customer.household_id ||= `HH-${String(householdNumber).padStart(5, "0")}`;
    customer.household_name ||= `${customer.last_name || "Customer"} Household`;
    customer.household_role ||= index % 2 === 0 ? "Primary" : "Household Member";
    customer.household_size ||= 1 + (seed % 5);
    customer.email ||= `${normalize(customer.first_name)}.${normalize(customer.last_name)}.${customer.customer_id.slice(-5)}@example.test`;
    customer.phone ||= `555-${String(100 + (seed % 800)).padStart(3, "0")}-${String(1000 + (seed % 9000)).padStart(4, "0")}`;
    customer.credit_score ||= creditScore;
    customer.risk_tier ||= riskTier(Number(customer.credit_score));
  });

  if (!data.accounts.some((account) => account.account_type === "Mortgage")) {
    data.customers.filter((_, index) => index % 8 === 0).forEach((customer, index) => {
      const accountId = `ACCT-${String(data.accounts.length + index + 1).padStart(6, "0")}`;
      const seed = stableNumber(customer.customer_id);
      data.accounts.push({
        account_id: accountId,
        customer_id: customer.customer_id,
        account_type: "Mortgage",
        masked_account_number: `****${String(7000 + (seed % 2000)).slice(-4)}`,
        open_date: `20${String(14 + (seed % 10)).padStart(2, "0")}-${String(1 + (seed % 12)).padStart(2, "0")}-${String(1 + (seed % 27)).padStart(2, "0")}`,
        status: "Open",
        current_balance: String(185000 + (seed * 311) % 420000),
        available_balance: "",
        credit_limit: "",
        apr: String((5.75 + (seed % 250) / 100).toFixed(2)),
        branch_code: `BR-${String(1 + (seed % 12)).padStart(3, "0")}`,
        synthetic_notice: "Synthetic mortgage account"
      });
    });
  }
}

function badge(text) {
  const cls = normalize(text).replace(/\s+/g, "-");
  return `<span class="badge ${cls.includes("urgent") ? "urgent" : ""} ${cls.includes("high") ? "high" : ""} ${cls.includes("escalated") ? "escalated" : ""} ${cls.includes("waiting") ? "waiting" : ""} ${cls.includes("progress") ? "progress" : ""} ${cls.includes("new") ? "new" : ""}">${text}</span>`;
}

function matchesQuery(row, extra = []) {
  if (!state.query) return true;
  const haystack = [...Object.values(row), row.issue_type, row.owner, row.sla, ...extra].map(normalize).join(" ");
  return haystack.includes(normalize(state.query));
}

function hydrateCase(c) {
  const customer = byId.customer.get(c.customer_id) ?? {};
  const account = byId.account.get(c.account_id) ?? {};
  const transaction = byId.transaction.get(c.related_transaction_id) ?? {};
  const kb = byId.kb.get(c.kb_article_id) ?? {};
  return { ...c, customer, account, transaction, kb };
}

function nextCaseId() {
  const nums = data.cases
    .map((c) => String(c.case_id || "").match(/^CASE-(\d{5})$/)?.[1])
    .filter(Boolean)
    .map(Number);
  const next = Math.max(0, ...nums) + 1;
  return `CASE-${String(next).padStart(5, "0")}`;
}

function normalizeCreatedCase(input) {
  const issueType = String(input.issue_type || input.category || "").trim();
  const owner = String(input.owner || input.assigned_queue || "").trim();
  return {
    case_id: String(input.case_id || nextCaseId()).trim(),
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

function upsertCases(cases) {
  for (const item of cases) {
    const normalized = normalizeCreatedCase(item);
    const index = data.cases.findIndex((c) => c.case_id === normalized.case_id);
    if (index >= 0) data.cases[index] = { ...data.cases[index], ...normalized };
    else data.cases.unshift(normalized);
  }
}

async function hydrateCasesFromApi() {
  try {
    const response = await fetch("/api/cases", { cache: "no-store" });
    if (!response.ok) throw new Error("Case API unavailable");
    const payload = await response.json();
    upsertCases(payload.cases || []);
    caseApiAvailable = true;
  } catch {
    caseApiAvailable = false;
    try {
      upsertCases(JSON.parse(localStorage.getItem("berryruthCreatedCases") || "[]"));
    } catch {
      // Ignore local draft parse issues.
    }
  }
}

async function createCase(record) {
  const normalized = normalizeCreatedCase(record);
  if (caseApiAvailable) {
    try {
      const response = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalized),
      });
      if (!response.ok) throw new Error("Create case failed");
      const payload = await response.json();
      upsertCases([payload.case]);
      return payload.case;
    } catch {
      caseApiAvailable = false;
    }
  }
  const localCases = JSON.parse(localStorage.getItem("berryruthCreatedCases") || "[]");
  const existing = localCases.findIndex((c) => c.case_id === normalized.case_id);
  if (existing >= 0) localCases[existing] = normalized;
  else localCases.unshift(normalized);
  localStorage.setItem("berryruthCreatedCases", JSON.stringify(localCases));
  upsertCases([normalized]);
  return normalized;
}

function nextAccountId() {
  const nums = data.accounts
    .map((a) => String(a.account_id || "").match(/^ACCT-(\d{6})$/)?.[1])
    .filter(Boolean)
    .map(Number);
  const next = Math.max(0, ...nums) + 1;
  return `ACCT-${String(next).padStart(6, "0")}`;
}

function maskedAccountNumber(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length >= 4) return `****${digits.slice(-4)}`;
  return `****${String(1000 + (stableNumber(nextAccountId()) % 9000)).slice(-4)}`;
}

function normalizeCreatedAccount(input) {
  const accountType = ACCOUNT_TYPES.includes(input.account_type) ? input.account_type : "Checking";
  const balance = input.current_balance === "" || input.current_balance === undefined ? "0" : String(input.current_balance);
  const creditLimit = accountType === "Credit Card" ? String(input.credit_limit || "5000") : String(input.credit_limit || "");
  const apr = ["Credit Card", "Mortgage", "Auto Loan", "Personal Loan"].includes(accountType) ? String(input.apr || "") : "";
  return {
    account_id: String(input.account_id || nextAccountId()).trim(),
    customer_id: String(input.customer_id || state.selectedCustomerId || "").trim(),
    account_type: accountType,
    masked_account_number: maskedAccountNumber(input.masked_account_number || input.account_number),
    open_date: input.open_date || new Date().toISOString().slice(0, 10),
    status: String(input.status || "Open").trim(),
    current_balance: balance,
    available_balance: accountType === "Credit Card" || accountType === "Mortgage" ? "" : String(input.available_balance || balance),
    credit_limit: creditLimit,
    apr,
    branch_code: String(input.branch_code || "BR-CRM").trim(),
    synthetic_notice: "User-created sandbox account",
    source: input.source || "CRM",
  };
}

function upsertAccounts(accounts) {
  for (const item of accounts) {
    const normalized = normalizeCreatedAccount(item);
    const index = data.accounts.findIndex((a) => a.account_id === normalized.account_id);
    if (index >= 0) data.accounts[index] = { ...data.accounts[index], ...normalized };
    else data.accounts.unshift(normalized);
    byId.account.set(normalized.account_id, normalized);
  }
}

async function hydrateAccountsFromApi() {
  try {
    const response = await fetch("/api/accounts", { cache: "no-store" });
    if (!response.ok) throw new Error("Account API unavailable");
    const payload = await response.json();
    upsertAccounts(payload.accounts || []);
    accountApiAvailable = true;
  } catch {
    accountApiAvailable = false;
    try {
      upsertAccounts(JSON.parse(localStorage.getItem(ACCOUNT_STORAGE_KEY) || "[]"));
    } catch {
      // Ignore local draft parse issues.
    }
  }
}

async function createAccount(record) {
  const normalized = normalizeCreatedAccount(record);
  if (accountApiAvailable) {
    try {
      const response = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalized),
      });
      if (!response.ok) throw new Error("Create account failed");
      const payload = await response.json();
      upsertAccounts([payload.account]);
      return payload.account;
    } catch {
      accountApiAvailable = false;
    }
  }
  const localAccounts = JSON.parse(localStorage.getItem(ACCOUNT_STORAGE_KEY) || "[]");
  const existing = localAccounts.findIndex((a) => a.account_id === normalized.account_id);
  if (existing >= 0) localAccounts[existing] = normalized;
  else localAccounts.unshift(normalized);
  localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(localAccounts));
  upsertAccounts([normalized]);
  return normalized;
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
    const subject = h.customer.full_name || c.customer_id || c.owner || "Unassigned";
    row.innerHTML = `
      <div class="row-top">
        <span class="case-id">${c.case_id}</span>
        ${badge(c.priority || "Medium")}
      </div>
      <div class="case-title">${titleCase(c.issue_type || c.category)} for ${subject}</div>
      <div class="inline">
        ${badge(c.status)}
        <span class="meta">${c.channel || "manual"} · ${c.owner || c.assigned_queue || "Unassigned"}${c.sla ? ` · SLA: ${c.sla}` : ""}</span>
      </div>
    `;
    row.addEventListener("click", () => {
      state.selectedCaseId = c.case_id;
      state.selectedArtifact = "caseNotes";
      state.isCreatingCase = false;
      renderCases();
      renderCaseDetail();
    });
    return row;
  }));
}

function renderCreateCaseForm() {
  const root = document.getElementById("caseDetail");
  const defaultId = nextCaseId();
  root.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>Create New Case</h2>
        <div class="meta">Add a sandbox case for UiPath Agent testing</div>
      </div>
    </div>
    <form id="newCaseForm" class="case-form">
      <label>Case ID<input name="case_id" value="${defaultId}" required></label>
      <label>Issue Type<input name="issue_type" placeholder="payment not posted" required></label>
      <label>Status
        <select name="status">
          <option>New</option>
          <option>In Progress</option>
          <option>Waiting on Customer</option>
          <option>Escalated</option>
          <option>Resolved</option>
        </select>
      </label>
      <label>Owner<input name="owner" placeholder="Payments Research" required></label>
      <label>SLA<input name="sla" placeholder="2 business days" required></label>
      <label class="wide">Resolution<textarea name="resolution" placeholder="Pending review"></textarea></label>
      <div class="form-actions wide">
        <button class="action-button" type="submit">Create Case</button>
        <button class="ghost-button" id="cancelCreateCase" type="button">Cancel</button>
      </div>
    </form>
  `;
  root.querySelector("#newCaseForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const record = Object.fromEntries(form.entries());
    const created = await createCase(record);
    state.selectedCaseId = created.case_id;
    state.isCreatingCase = false;
    populateFilters();
    renderSummary();
    renderCases();
    renderCaseDetail();
  });
  root.querySelector("#cancelCreateCase").addEventListener("click", () => {
    state.isCreatingCase = false;
    renderCaseDetail();
  });
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
  if (state.isCreatingCase) {
    renderCreateCaseForm();
    return;
  }
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
        <h2>${c.case_id} · ${titleCase(c.issue_type || c.category)}</h2>
        <div class="inline">
          ${badge(c.status)}
          ${badge(c.priority)}
          <span class="meta">${c.opened_at} · ${c.owner || c.assigned_queue || "Unassigned"}${c.sla ? ` · SLA: ${c.sla}` : ""}</span>
        </div>
      </div>
      <div class="detail-actions">
        <button class="action-button" id="mockResolve" type="button">Mark Reviewed</button>
      </div>
    </div>
    <div class="case-overview">
      <div>
        <span class="overview-label">Customer</span>
        <strong>${h.customer.full_name || c.customer_id}</strong>
        <small>${h.customer.email || ""}${h.customer.phone ? ` · ${h.customer.phone}` : ""}</small>
      </div>
      <div>
        <span class="overview-label">Owner / SLA</span>
        <strong>${c.owner || c.assigned_queue || "Unassigned"}</strong>
        <small>${c.sla || "No SLA"}</small>
      </div>
      <div>
        <span class="overview-label">Account</span>
        <strong>${h.account.account_type || "Account"} ${h.account.masked_account_number || c.account_id}</strong>
        <small>${h.transaction.description || c.related_transaction_id}</small>
      </div>
      <div>
        <span class="overview-label">Resolution</span>
        <strong>${c.resolution || "Pending"}</strong>
        <small>${c.customer_sentiment || "Neutral"} sentiment</small>
      </div>
    </div>
    <div class="detail-grid">
      ${recommendationSection}
      <div class="section">
        <h3>Case Metadata</h3>
        <div class="section-body">
          ${renderKv([
            ["Issue type", c.issue_type || c.category],
            ["Status", c.status],
            ["Owner", c.owner || c.assigned_queue],
            ["SLA", c.sla],
            ["Resolution", c.resolution],
            ["Customer", h.customer.full_name ? `${h.customer.full_name} (${c.customer_id})` : c.customer_id],
            ["Account", h.account.account_type ? `${h.account.account_type} ${h.account.masked_account_number}` : c.account_id],
            ["Related item", h.transaction.description ? `${h.transaction.description} (${h.transaction.status})` : c.related_transaction_id],
            ["KB article", h.kb.title ? `${c.kb_article_id} · ${h.kb.title}` : c.kb_article_id],
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
              ${transactions.length ? transactions.map((t) => `<tr><td>${t.transaction_date}</td><td>${t.description}</td><td>${money(t.amount)}</td><td>${t.status}</td></tr>`).join("") : `<tr><td colspan="4">No linked account activity for this case.</td></tr>`}
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
    state.isCreatingAccount = false;
    renderCustomers();
  }, state.selectedCustomerId);
  renderCustomerDetail();
}

function renderAccountForm(customer) {
  if (!state.isCreatingAccount) return "";
  return `
    <form id="newAccountForm" class="case-form account-form">
      <label>Account ID<input name="account_id" value="${nextAccountId()}" required></label>
      <label>Account Type
        <select name="account_type">
          ${ACCOUNT_TYPES.map((type) => `<option>${type}</option>`).join("")}
        </select>
      </label>
      <label>Status
        <select name="status">
          <option>Open</option>
          <option>Pending</option>
          <option>Restricted</option>
          <option>Closed</option>
        </select>
      </label>
      <label>Masked Number<input name="masked_account_number" placeholder="****1234" required></label>
      <label>Balance<input name="current_balance" type="number" step="0.01" value="0" required></label>
      <label>Credit Limit<input name="credit_limit" type="number" step="0.01" placeholder="Credit cards only"></label>
      <label>APR<input name="apr" type="number" step="0.01" placeholder="Loans/cards"></label>
      <label>Open Date<input name="open_date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
      <input name="customer_id" type="hidden" value="${customer.customer_id}">
      <div class="form-actions">
        <button class="action-button" type="submit">Create Account</button>
        <button class="ghost-button" id="cancelCreateAccount" type="button">Cancel</button>
      </div>
    </form>
  `;
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
          ["Household", `${customer.household_name} (${customer.household_id})`],
          ["Household role", customer.household_role],
          ["Household size", customer.household_size],
          ["Email", customer.email],
          ["Phone", customer.phone],
          ["Address", `${customer.street_address}, ${customer.city}, ${customer.state} ${customer.zip}`],
          ["Credit score", customer.credit_score],
          ["Risk tier", customer.risk_tier],
          ["Segment", customer.segment],
          ["Since", customer.customer_since],
        ])}
      </div>
    </div>
    <div class="section">
      <div class="section-title-row">
        <h3>Accounts</h3>
        <button id="newAccountButton" class="action-button compact" type="button">New Account</button>
      </div>
      <div class="section-body">
        ${renderAccountForm(customer)}
        <table class="mini-table">
          <thead><tr><th>Account</th><th>Type</th><th>Balance</th><th>Limit/APR</th><th>Status</th></tr></thead>
          <tbody>${accounts.map((a) => `<tr><td>${a.masked_account_number}</td><td>${a.account_type}</td><td>${money(a.current_balance)}</td><td>${a.credit_limit ? money(a.credit_limit) : ""}${a.apr ? ` / ${a.apr}%` : ""}</td><td>${a.status}</td></tr>`).join("") || `<tr><td colspan="5">No accounts</td></tr>`}</tbody>
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

  document.getElementById("newAccountButton")?.addEventListener("click", () => {
    state.isCreatingAccount = true;
    renderCustomerDetail();
  });
  document.getElementById("cancelCreateAccount")?.addEventListener("click", () => {
    state.isCreatingAccount = false;
    renderCustomerDetail();
  });
  document.getElementById("newAccountForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const record = Object.fromEntries(new FormData(form).entries());
    const created = await createAccount(record);
    state.isCreatingAccount = false;
    state.selectedCustomerId = created.customer_id;
    renderActiveView();
  });
}

async function hydrateLoanDocuments() {
  try {
    const response = await fetch("/api/loan-documents", { cache: "no-store" });
    if (!response.ok) throw new Error("Loan documents unavailable");
    const payload = await response.json();
    state.loanDocs = payload.documents || [];
    state.loanPackages = Object.values(state.loanDocs.reduce((acc, doc) => {
      acc[doc.loan_id] ||= {
        loan_id: doc.loan_id,
        customer_id: doc.customer_id,
        customer_name: doc.customer_name,
        email: doc.email,
        phone: doc.phone,
        address: doc.address,
        risk_tier: doc.risk_tier,
        credit_score: doc.credit_score,
        count: 0,
      };
      acc[doc.loan_id].count += 1;
      return acc;
    }, {}));
    state.selectedLoanId ||= state.loanPackages[0]?.loan_id || null;
    state.selectedLoanDocPath ||= state.loanDocs.find((doc) => doc.loan_id === state.selectedLoanId)?.relative_path || null;
    await loadSelectedLoanDocument();
  } catch {
    state.loanDocs = [];
    state.loanPackages = [];
    state.loanDocPreview = "Loan document repository is unavailable.";
  }
}

async function loadSelectedLoanDocument() {
  if (!state.selectedLoanDocPath) {
    state.loanDocPreview = "Select a loan document to preview it.";
    return;
  }
  try {
    const response = await fetch(`/api/loan-documents/content?path=${encodeURIComponent(state.selectedLoanDocPath)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Document unavailable");
    const payload = await response.json();
    state.loanDocPreview = payload.content || "Document is empty.";
  } catch {
    state.loanDocPreview = "Unable to load this document.";
  }
}

function renderLoanDocumentFilters() {
  const select = document.getElementById("loanDocTypeFilter");
  const values = ["All document types", ...new Set(state.loanDocs.map((doc) => doc.document_type))];
  select.replaceChildren(...values.map((value) => {
    const option = el("option", "", value);
    option.value = value;
    option.selected = value === state.loanDocType;
    return option;
  }));
}

function filteredLoanDocs() {
  return state.loanDocs.filter((doc) => {
    const matchesPackage = !state.selectedLoanId || doc.loan_id === state.selectedLoanId;
    const matchesType = state.loanDocType === "All document types" || doc.document_type === state.loanDocType;
    return matchesPackage && matchesType && matchesQuery(doc);
  });
}

function selectedLoanDocs() {
  return state.loanDocs.filter((doc) => doc.loan_id === state.selectedLoanId);
}

function nextLoanId() {
  const nums = state.loanDocs
    .map((doc) => String(doc.loan_id || "").match(/^LOAN-(\d{5})$/)?.[1])
    .filter(Boolean)
    .map(Number);
  return `LOAN-${String(Math.max(0, ...nums) + 1).padStart(5, "0")}`;
}

async function createLoanPackage(record) {
  const response = await fetch("/api/loans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Create loan failed");
  }
  const payload = await response.json();
  await hydrateLoanDocuments();
  state.selectedLoanId = payload.loan.loan_id;
  state.selectedLoanDocPath = payload.loan.relative_path;
  await loadSelectedLoanDocument();
  return payload.loan;
}

function renderNewLoanForm() {
  const host = document.getElementById("newLoanFormHost");
  if (!state.isCreatingLoan) {
    host.replaceChildren();
    return;
  }
  host.innerHTML = `
    <form id="newLoanForm" class="case-form loan-doc-form new-loan-form">
      <label>Loan ID<input name="loan_id" value="${nextLoanId()}" required></label>
      <label>Existing Customer ID<input name="customer_id" list="customerIdOptions" placeholder="CUST-00001" required></label>
      <datalist id="customerIdOptions">
        ${data.customers.map((customer) => `<option value="${customer.customer_id}">${customer.full_name}</option>`).join("")}
      </datalist>
      <label>Customer Name<input name="customer_name" placeholder="Required for new customer"></label>
      <label>Email<input name="email" type="email" placeholder="customer@example.test"></label>
      <label>Phone<input name="phone" placeholder="555-100-1000"></label>
      <label>Risk Tier
        <select name="risk_tier">
          <option></option>
          <option>Low</option>
          <option>Moderate</option>
          <option>High</option>
        </select>
      </label>
      <label>Credit Score<input name="credit_score" type="number" min="300" max="850" placeholder="700"></label>
      <label>Loan Amount<input name="loan_amount" placeholder="$350,000"></label>
      <label>Purchase Price<input name="purchase_price" placeholder="$425,000"></label>
      <label class="wide">Address<input name="address" placeholder="Customer mailing address"></label>
      <label class="wide">Property Address<input name="property_address" placeholder="Property address"></label>
      <label class="wide">Loan Purpose<input name="loan_purpose" placeholder="Primary residence purchase"></label>
      <div class="form-actions">
        <button class="action-button" type="submit">Create Loan</button>
        <button class="ghost-button" id="cancelNewLoan" type="button">Cancel</button>
      </div>
    </form>
  `;
  document.getElementById("cancelNewLoan")?.addEventListener("click", () => {
    state.isCreatingLoan = false;
    renderLoanDocuments();
  });
  document.getElementById("newLoanForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.getElementById("loanDocCount");
    try {
      status.textContent = "Creating loan...";
      const record = Object.fromEntries(new FormData(event.currentTarget).entries());
      await createLoanPackage(record);
      state.isCreatingLoan = false;
      renderLoanDocuments();
      document.getElementById("loanDocumentPreview")?.scrollTo({ top: 0 });
    } catch (error) {
      status.textContent = error.message;
    }
  });
}

async function createLoanDocument(record) {
  const response = await fetch("/api/loan-documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Create loan document failed");
  }
  const payload = await response.json();
  await hydrateLoanDocuments();
  state.selectedLoanId = payload.document.loan_id;
  state.selectedLoanDocPath = payload.document.relative_path;
  await loadSelectedLoanDocument();
  return payload.document;
}

function renderNewLoanDocForm() {
  const host = document.getElementById("newLoanDocFormHost");
  if (!state.isCreatingLoanDoc) {
    host.replaceChildren();
    return;
  }
  const loanId = state.selectedLoanId || "";
  host.innerHTML = `
    <form id="newLoanDocForm" class="case-form loan-doc-form">
      <label>Loan ID<input name="loan_id" value="${loanId}" readonly required></label>
      <label>Document Type
        <select name="document_type" required>
          <option>Loan application</option>
          <option>Paystub</option>
          <option>Bank statements</option>
          <option>W-2 or 1099 summary</option>
          <option>Tax return summary</option>
          <option>Purchase contract</option>
          <option>Appraisal summary</option>
          <option>Other supporting document</option>
        </select>
      </label>
      <label>Demo Use
        <select name="demo_use" required>
          <option>Data extraction</option>
          <option>Income verification</option>
          <option>Asset verification</option>
          <option>Income validation</option>
          <option>Property/loan validation</option>
          <option>Property valuation</option>
          <option>Supporting documentation</option>
        </select>
      </label>
      <label>Document Key<input name="document_key" placeholder="verification_notes"></label>
      <label class="wide">Document Details<textarea name="details" placeholder="Enter the document details to save into the repository." required></textarea></label>
      <div class="form-actions">
        <button class="action-button" type="submit">Save Document</button>
        <button class="ghost-button" id="cancelNewLoanDoc" type="button">Cancel</button>
      </div>
    </form>
  `;
  document.getElementById("cancelNewLoanDoc")?.addEventListener("click", () => {
    state.isCreatingLoanDoc = false;
    renderLoanDocuments();
  });
  document.getElementById("newLoanDocForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.getElementById("loanDocSelection");
    try {
      status.textContent = "Saving document...";
      const record = Object.fromEntries(new FormData(form).entries());
      await createLoanDocument(record);
      state.isCreatingLoanDoc = false;
      renderLoanDocuments();
      document.getElementById("loanDocumentPreview")?.scrollTo({ top: 0 });
    } catch (error) {
      status.textContent = error.message;
    }
  });
}

function renderSelectedLoanSummary() {
  const root = document.getElementById("selectedLoanSummary");
  const docs = selectedLoanDocs();
  const primary = docs[0];
  if (!primary) {
    root.innerHTML = `<div class="empty">Select a loan package to view details.</div>`;
    return;
  }
  const customer = byId.customer.get(primary.customer_id) || {};
  const typeSummary = [...new Set(docs.map((doc) => doc.document_type))].join(", ");
  root.innerHTML = `
    <div>
      <div class="eyebrow">${primary.loan_id}</div>
      <h3>${primary.customer_name}</h3>
      <p>${primary.customer_id} · ${primary.address}</p>
    </div>
    <div class="loan-summary-grid">
      ${renderKv([
        ["Email", primary.email],
        ["Phone", primary.phone],
        ["Credit score", primary.credit_score],
        ["Risk tier", primary.risk_tier],
        ["Segment", customer.segment || "-"],
        ["Documents", `${docs.length} docs`],
      ])}
    </div>
    <div class="loan-doc-type-strip">${typeSummary}</div>
  `;
}

function renderLoanDocuments() {
  renderLoanDocumentFilters();
  const packageRoot = document.getElementById("loanPackageList");
  renderNewLoanForm();
  renderNewLoanDocForm();
  renderSelectedLoanSummary();
  document.getElementById("loanDocCount").textContent = `${state.loanPackages.length} packages · ${state.loanDocs.length} documents`;
  packageRoot.innerHTML = state.loanPackages.map((pkg) => {
    const active = pkg.loan_id === state.selectedLoanId;
    return `
      <button class="loan-package ${active ? "active" : ""}" data-loan-id="${pkg.loan_id}" type="button">
        <strong>${pkg.loan_id}</strong>
        <span>${pkg.customer_name} · ${pkg.customer_id}</span>
        <small>${pkg.count} docs · Score ${pkg.credit_score} · ${pkg.risk_tier} risk</small>
        ${active ? `
          <div class="loan-package-detail">
            <div><b>Email</b><span>${pkg.email}</span></div>
            <div><b>Phone</b><span>${pkg.phone}</span></div>
            <div class="wide"><b>Address</b><span>${pkg.address}</span></div>
          </div>
        ` : ""}
      </button>
    `;
  }).join("") || `<div class="empty">No loan packages found.</div>`;

  packageRoot.querySelectorAll("[data-loan-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.selectedLoanId = button.dataset.loanId;
      state.isCreatingLoan = false;
      state.isCreatingLoanDoc = false;
      state.selectedLoanDocPath = state.loanDocs.find((doc) => doc.loan_id === state.selectedLoanId)?.relative_path || null;
      await loadSelectedLoanDocument();
      renderLoanDocuments();
      document.getElementById("selectedLoanSummary")?.scrollIntoView({ block: "nearest" });
      document.getElementById("loanDocumentPreview")?.scrollTo({ top: 0 });
    });
  });

  const docs = filteredLoanDocs();
  document.getElementById("loanDocSelection").textContent = state.selectedLoanId ? `${state.selectedLoanId} · ${docs.length} visible` : "";
  renderTable("loanDocumentTable", docs, [
    { key: "document_type", label: "Document" },
    { key: "demo_use", label: "Demo Use" },
    { key: "customer_id", label: "Customer" },
    { key: "relative_path", label: "File", render: (row) => row.relative_path.split("/").pop() },
  ], async (row) => {
    state.selectedLoanDocPath = row.relative_path;
    await loadSelectedLoanDocument();
    renderLoanDocuments();
    document.getElementById("loanDocumentPreview")?.scrollTo({ top: 0 });
  }, state.selectedLoanDocPath);

  const preview = document.getElementById("loanDocumentPreview");
  preview.textContent = state.loanDocPreview;
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
  if (state.view === "loanDocs") renderLoanDocuments();
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
  document.getElementById("newLoanButton").addEventListener("click", () => {
    state.isCreatingLoan = true;
    state.isCreatingLoanDoc = false;
    renderLoanDocuments();
  });
  document.getElementById("newLoanDocButton").addEventListener("click", () => {
    state.isCreatingLoanDoc = true;
    state.isCreatingLoan = false;
    renderLoanDocuments();
  });
  document.getElementById("loanDocTypeFilter").addEventListener("change", async (event) => {
    state.loanDocType = event.target.value;
    const docs = filteredLoanDocs();
    state.selectedLoanDocPath = docs[0]?.relative_path || null;
    await loadSelectedLoanDocument();
    renderLoanDocuments();
  });
  document.getElementById("newCaseButton").addEventListener("click", () => {
    state.isCreatingCase = true;
    state.selectedCaseId = null;
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
  await hydrateAccountsFromApi();
  await hydrateCasesFromApi();
  await hydrateLoanDocuments();
  await hydrateAgentRecommendationsFromApi();
  populateFilters();
  bindEvents();
  renderActiveView();
}

initialize();
