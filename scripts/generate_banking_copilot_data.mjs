import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const artifactsDir = path.join(rootDir, "artifacts");
const outputsDir = path.join(rootDir, "outputs", "case_resolution_copilot");

const COUNTS = {
  customers: 200,
  accounts: 400,
  transactions: 1000,
  cases: 100,
  kbArticles: 30,
  goldenAnswers: 50,
};

const categories = [
  "overdraft fee reversal",
  "card replacement",
  "address change",
  "payment not posted",
  "account access issue",
  "wire transfer question",
  "loan payoff question",
  "dispute handoff",
  "complaint escalation",
];

const categoryConfig = {
  "overdraft fee reversal": {
    queue: "Deposits Servicing",
    policy: "Fee Reversal Playbook",
    intent: "Customer requests an overdraft fee refund after a timing or courtesy issue.",
    disposition: "Fee decision documented",
    next: "Apply courtesy credit when eligible; otherwise explain policy and alternatives.",
  },
  "card replacement": {
    queue: "Cards Operations",
    policy: "Debit Card Replacement Procedure",
    intent: "Customer needs a replacement card due to loss, damage, expiration, or suspected compromise.",
    disposition: "Card replacement initiated",
    next: "Verify identity, block old card when needed, confirm delivery address and shipping speed.",
  },
  "address change": {
    queue: "Customer Maintenance",
    policy: "Address Change Verification Standard",
    intent: "Customer asks to update mailing or residential address.",
    disposition: "Address update queued",
    next: "Complete step-up verification and confirm tax-document and card-delivery impacts.",
  },
  "payment not posted": {
    queue: "Payments Research",
    policy: "Missing Payment Research Guide",
    intent: "Customer says a bill pay, loan, card, or deposit payment has not appeared.",
    disposition: "Payment research opened",
    next: "Collect trace data, check posting windows, and open research if outside SLA.",
  },
  "account access issue": {
    queue: "Digital Support",
    policy: "Online Access Recovery Guide",
    intent: "Customer cannot sign in, pass MFA, reset password, or access mobile banking.",
    disposition: "Access recovery completed",
    next: "Validate identity, unlock profile, reset MFA when appropriate, and warn about scams.",
  },
  "wire transfer question": {
    queue: "Wire Desk",
    policy: "Wire Transfer FAQ",
    intent: "Customer asks about wire status, cutoff, fees, limits, or required details.",
    disposition: "Wire guidance provided",
    next: "Explain cutoff, fee, status, and escalation path without promising settlement.",
  },
  "loan payoff question": {
    queue: "Loan Servicing",
    policy: "Loan Payoff Quote Procedure",
    intent: "Customer requests payoff balance, quote expiration, per diem, or lien release timing.",
    disposition: "Payoff instructions sent",
    next: "Generate payoff quote, explain good-through date and acceptable payment methods.",
  },
  "dispute handoff": {
    queue: "Disputes Intake",
    policy: "Reg E Dispute Intake Checklist",
    intent: "Customer reports an unauthorized or incorrect transaction that requires formal dispute handling.",
    disposition: "Dispute handoff completed",
    next: "Capture facts, provide provisional credit expectations, and transfer to disputes.",
  },
  "complaint escalation": {
    queue: "Executive Resolution",
    policy: "Complaint Escalation Standard",
    intent: "Customer expresses dissatisfaction, regulatory concern, hardship, or repeated unresolved contact.",
    disposition: "Complaint escalated",
    next: "Acknowledge complaint, avoid defensiveness, create escalation record, and set follow-up window.",
  },
};

const firstNames = [
  "Avery", "Jordan", "Morgan", "Riley", "Casey", "Taylor", "Quinn", "Jamie", "Alex", "Drew",
  "Skyler", "Reese", "Rowan", "Parker", "Hayden", "Cameron", "Emerson", "Finley", "Harper", "Kendall",
  "Logan", "Marley", "Noel", "Payton", "Robin", "Sage", "Tatum", "Vaughn", "Winter", "Blair",
];
const lastNames = [
  "Bennett", "Carter", "Diaz", "Ellis", "Foster", "Garcia", "Hughes", "Irwin", "Jensen", "Kim",
  "Lewis", "Morris", "Nguyen", "Owens", "Patel", "Quincy", "Reed", "Singh", "Turner", "Usman",
  "Vega", "Walsh", "Xu", "Young", "Zimmer", "Cole", "Nolan", "Price", "Stone", "Wells",
];
const streets = ["Maple", "Cedar", "Pine", "Oak", "Lake", "Hill", "River", "Sunset", "Market", "Union"];
const cities = [
  ["Albany", "NY"], ["Raleigh", "NC"], ["Columbus", "OH"], ["Tampa", "FL"], ["Denver", "CO"],
  ["Phoenix", "AZ"], ["Portland", "OR"], ["Austin", "TX"], ["Madison", "WI"], ["Richmond", "VA"],
  ["Sacramento", "CA"], ["Boise", "ID"], ["Nashville", "TN"], ["Omaha", "NE"], ["Tulsa", "OK"],
];
const accountTypes = ["Checking", "Savings", "Credit Card", "Auto Loan", "Personal Loan", "Money Market"];
const segments = ["Everyday", "Student", "Mass Affluent", "Small Business Owner", "Senior", "New-to-Bank"];
const channels = ["chat", "email", "phone", "secure message"];
const caseStatuses = ["New", "In Progress", "Waiting on Customer", "Resolved", "Escalated"];
const priorities = ["Low", "Medium", "High", "Urgent"];
const merchants = [
  "Metro Grocery", "Northline Utilities", "RideNow Transit", "Bluebird Pharmacy", "City Fitness",
  "StreamBox Media", "Corner Cafe", "Atlas Wireless", "Harbor Insurance", "BrightFuel",
  "GreenLeaf Market", "Oak & Main", "TuitionPay", "FastShip", "MedPlus Clinic",
];
const states = ["AL", "AZ", "CA", "CO", "FL", "GA", "IL", "MA", "NC", "NJ", "NY", "OH", "OR", "PA", "TX", "VA", "WA", "WI"];

let seed = 42075;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const money = (min, max) => Number((min + rand() * (max - min)).toFixed(2));
const pad = (num, size) => String(num).padStart(size, "0");
const isoDate = (daysAgo) => {
  const d = new Date(Date.UTC(2026, 5, 23));
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};
const shortDateTime = (daysAgo, hour) => `${isoDate(daysAgo)} ${pad(hour, 2)}:${pad(Math.floor(rand() * 60), 2)} ET`;
const escapeCsv = (value) => {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const toCsv = (rows) => {
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((row) => headers.map((h) => escapeCsv(row[h])).join(","))].join("\n") + "\n";
};
const writeCsv = async (name, rows) => fs.writeFile(path.join(dataDir, name), toCsv(rows), "utf8");
const mkdirp = (dir) => fs.mkdir(dir, { recursive: true });
const safeName = (text) => text.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").toLowerCase();

function makeCustomers() {
  const rows = [];
  for (let i = 1; i <= COUNTS.customers; i++) {
    const first = pick(firstNames);
    const last = pick(lastNames);
    const [city, state] = pick(cities);
    rows.push({
      customer_id: `CUST-${pad(i, 5)}`,
      first_name: first,
      last_name: `${last}${i % 19 === 0 ? "-Synthetic" : ""}`,
      full_name: `${first} ${last}`,
      email: `${first}.${last}.${pad(i, 5)}@example.test`.toLowerCase(),
      phone: `555-${pad(100 + (i % 800), 3)}-${pad(1000 + ((i * 37) % 9000), 4)}`,
      street_address: `${100 + i * 7} ${pick(streets)} ${pick(["St", "Ave", "Rd", "Ln", "Blvd"])}`,
      city,
      state,
      zip: `${pad(10000 + ((i * 83) % 89999), 5)}`,
      segment: segments[i % segments.length],
      preferred_contact: channels[i % channels.length],
      customer_since: isoDate(365 + Math.floor(rand() * 3500)),
      synthetic_notice: "Synthetic test customer; not a real person",
    });
  }
  return rows;
}

function makeAccounts(customers) {
  const rows = [];
  for (let i = 1; i <= COUNTS.accounts; i++) {
    const customer = customers[(i - 1) % customers.length];
    const type = accountTypes[(i + Math.floor(i / 17)) % accountTypes.length];
    const isLoan = type.includes("Loan");
    const isCard = type.includes("Card");
    const balance = isLoan ? money(1200, 42000) : isCard ? money(-850, 6200) : money(50, 24500);
    rows.push({
      account_id: `ACCT-${pad(i, 6)}`,
      customer_id: customer.customer_id,
      account_type: type,
      masked_account_number: `****${pad(1000 + ((i * 29) % 9000), 4)}`,
      open_date: isoDate(60 + Math.floor(rand() * 2600)),
      status: i % 47 === 0 ? "Restricted" : i % 23 === 0 ? "Dormant" : "Open",
      current_balance: balance,
      available_balance: isLoan ? "" : Number((balance - money(0, 300)).toFixed(2)),
      credit_limit: isCard ? money(1500, 15000) : "",
      apr: isLoan || isCard ? Number((5.99 + rand() * 17).toFixed(2)) : "",
      branch_code: `BR-${pad(1 + (i % 32), 3)}`,
      synthetic_notice: "Synthetic test account",
    });
  }
  return rows;
}

function makeTransactions(accounts) {
  const rows = [];
  for (let i = 1; i <= COUNTS.transactions; i++) {
    const account = accounts[(i * 7) % accounts.length];
    const days = 1 + Math.floor(rand() * 150);
    const debit = rand() < 0.72;
    const category = debit ? pick(["POS", "ACH Debit", "Fee", "ATM", "Bill Pay", "Card Purchase"]) : pick(["ACH Credit", "Deposit", "Refund", "Transfer In"]);
    const merchant = category === "Fee" ? pick(["Overdraft Fee", "Returned Item Fee", "Wire Fee", "Expedited Card Fee"]) : pick(merchants);
    const amount = category === "Fee" ? -money(3, 36) : debit ? -money(4, 780) : money(25, 3500);
    rows.push({
      transaction_id: `TXN-${pad(i, 7)}`,
      account_id: account.account_id,
      customer_id: account.customer_id,
      transaction_date: isoDate(days),
      posted_date: isoDate(Math.max(days - (rand() < 0.15 ? 2 : 0), 0)),
      description: `${category} - ${merchant}`,
      merchant_name: merchant,
      transaction_type: category,
      amount,
      status: rand() < 0.06 ? "Pending" : "Posted",
      reference_number: `REF${pad(i * 193, 10)}`,
      synthetic_notice: "Synthetic transaction",
    });
  }
  return rows;
}

function makeKbArticles() {
  const rows = [];
  for (let i = 1; i <= COUNTS.kbArticles; i++) {
    const category = categories[(i - 1) % categories.length];
    const cfg = categoryConfig[category];
    rows.push({
      article_id: `KB-${pad(i, 4)}`,
      category,
      title: `${cfg.policy} ${i > categories.length ? "Addendum" : ""}`.trim(),
      audience: i % 5 === 0 ? "Supervisor" : "Frontline Agent",
      last_reviewed: isoDate(5 + i * 3),
      summary: cfg.intent,
      policy_keywords: [category, cfg.queue, cfg.disposition].join("; "),
      source_system: "KnowledgeBase-SYN",
      synthetic_notice: "Synthetic knowledge article",
    });
  }
  return rows;
}

function makeCases(customers, accounts, transactions, kbArticles) {
  const rows = [];
  for (let i = 1; i <= COUNTS.cases; i++) {
    const category = categories[(i - 1) % categories.length];
    const customer = customers[(i * 11) % customers.length];
    const ownedAccounts = accounts.filter((a) => a.customer_id === customer.customer_id);
    const account = ownedAccounts[i % ownedAccounts.length] ?? accounts[(i * 13) % accounts.length];
    const relatedTxn = transactions.find((t) => t.account_id === account.account_id) ?? transactions[(i * 17) % transactions.length];
    const cfg = categoryConfig[category];
    const article = kbArticles.find((a) => a.category === category);
    const status = i % 10 === 0 ? "Escalated" : caseStatuses[i % caseStatuses.length];
    rows.push({
      case_id: `CASE-${pad(i, 5)}`,
      customer_id: customer.customer_id,
      account_id: account.account_id,
      related_transaction_id: relatedTxn.transaction_id,
      category,
      channel: channels[i % channels.length],
      priority: i % 13 === 0 ? "Urgent" : priorities[i % priorities.length],
      status,
      opened_at: shortDateTime(1 + Math.floor(rand() * 45), 8 + (i % 9)),
      assigned_queue: cfg.queue,
      kb_article_id: article.article_id,
      short_summary: cfg.intent,
      requested_action: cfg.next,
      resolution: status === "Resolved" ? cfg.disposition : "Pending copilot recommendation",
      customer_sentiment: i % 8 === 0 ? "Frustrated" : i % 5 === 0 ? "Confused" : "Neutral",
      synthetic_notice: "Synthetic service case",
    });
  }
  return rows;
}

function makeGoldenAnswers(cases) {
  const rows = [];
  for (let i = 1; i <= COUNTS.goldenAnswers; i++) {
    const c = cases[(i * 3) % cases.length];
    const cfg = categoryConfig[c.category];
    rows.push({
      test_id: `GOLD-${pad(i, 4)}`,
      case_id: c.case_id,
      category: c.category,
      user_question: `Draft the next best response for ${c.case_id} and identify required policy checks.`,
      expected_intent: cfg.intent,
      expected_next_action: cfg.next,
      required_evidence: `Use ${c.kb_article_id}, account ${c.account_id}, transaction ${c.related_transaction_id}, and case notes.`,
      must_include: "Empathetic acknowledgement; verification boundary; policy-based next step; no guarantee of outcome",
      must_not_include: "Real customer PII; guaranteed fee refund; legal advice; final dispute decision outside authority",
      pass_criteria: "Answer cites the correct policy, respects handoff/escalation rules, and gives a clear customer-safe response.",
      synthetic_notice: "Synthetic golden-answer test",
    });
  }
  return rows;
}

function caseArtifactText(caseRow, customer, account, transaction) {
  const cfg = categoryConfig[caseRow.category];
  const agent = pick(["N. Brooks", "M. Shah", "T. Rivera", "A. Chen", "S. Morgan"]);
  const amountText = transaction.amount === "" ? "$0.00" : `$${Math.abs(Number(transaction.amount)).toFixed(2)}`;
  return {
    chat: `# Chat Transcript - ${caseRow.case_id}

Synthetic artifact for mock Customer Service Case Resolution Copilot testing.

Customer: ${customer.full_name} (${customer.customer_id})
Channel: ${caseRow.channel}
Category: ${caseRow.category}

Customer: Hi, I need help with my account ending in ${account.masked_account_number}.
Agent ${agent}: I can help. I will first verify the profile and then review what happened.
Customer: The issue is about ${caseRow.category}. I noticed it after the transaction ${transaction.reference_number}.
Agent ${agent}: I see the related item listed as "${transaction.description}" for ${amountText}, status ${transaction.status}.
Customer: What can you do today?
Agent ${agent}: I will follow the ${cfg.policy} and document the next step: ${cfg.next}

No real customer data is present in this transcript.
`,
    email: `# Email Thread - ${caseRow.case_id}

From: ${customer.email}
To: support@berryruth-bank.test
Subject: Help requested - ${caseRow.category}

Hello,

I am writing about account ${account.masked_account_number}. The case relates to ${caseRow.category}.
Please review reference ${transaction.reference_number}. I prefer contact by ${customer.preferred_contact}.

Reply from BerryRuth Bank Support:

Thank you for contacting us. We have opened ${caseRow.case_id}. For your protection, we will not ask for your full account number by email. Our next step is: ${cfg.next}
`,
    callNotes: `# Call Notes - ${caseRow.case_id}

- Caller verified using synthetic profile challenge.
- Customer sentiment: ${caseRow.customer_sentiment}.
- Stated concern: ${cfg.intent}
- Account reviewed: ${account.account_type} ${account.masked_account_number}.
- Related transaction: ${transaction.transaction_id} / ${transaction.description} / ${transaction.status}.
- Agent action: ${caseRow.resolution}.
- Follow-up window: ${caseRow.priority === "Urgent" ? "1 business day" : "2-3 business days"}.
`,
    caseNotes: `# Case Notes - ${caseRow.case_id}

## Summary
${caseRow.short_summary}

## Evidence
- Customer: ${customer.customer_id}
- Account: ${account.account_id}
- Transaction: ${transaction.transaction_id}
- KB article: ${caseRow.kb_article_id}

## Copilot Guidance
${cfg.next}

## Guardrails
- Do not reveal internal risk notes.
- Do not guarantee outcomes before required operations team review.
- Keep all identifiers masked in customer-facing responses.
`,
    statementSnippet: `# Statement Snippet - ${caseRow.case_id}

Account: ${account.account_type} ${account.masked_account_number}
Statement period: ${isoDate(32)} to ${isoDate(2)}

| Date | Description | Amount | Status | Reference |
|---|---:|---:|---|---|
| ${transaction.transaction_date} | ${transaction.description} | ${transaction.amount} | ${transaction.status} | ${transaction.reference_number} |
| ${isoDate(6)} | Balance update | ${account.current_balance} | Posted | BAL${account.account_id.slice(-4)} |

This statement snippet is synthetic and abbreviated for retrieval tests.
`,
    template: `# Agent Response Template - ${caseRow.case_id}

Hi ${customer.first_name},

Thanks for contacting us about ${caseRow.category}. I reviewed the case details for your account ending in ${account.masked_account_number} and the related reference ${transaction.reference_number}.

Based on our ${cfg.policy}, the next step is: ${cfg.next}

For your security, please do not send full account numbers, passwords, one-time codes, or full card numbers in this conversation.

Thank you,
BerryRuth Bank Support
`,
    screenshot: `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Simple Account Screenshot - ${caseRow.case_id}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 24px; color: #1f2933; background: #f7f9fb; }
  .panel { width: 720px; border: 1px solid #cfd8e3; background: #fff; border-radius: 6px; overflow: hidden; }
  .top { background: #103b57; color: #fff; padding: 16px 20px; font-weight: 700; }
  .grid { display: grid; grid-template-columns: 190px 1fr; gap: 0; }
  .label { background: #eef3f7; padding: 10px 14px; border-top: 1px solid #d8e0e8; font-weight: 700; }
  .value { padding: 10px 14px; border-top: 1px solid #d8e0e8; }
  .notice { padding: 12px 20px; color: #5b6776; font-size: 13px; }
</style>
<div class="panel">
  <div class="top">BerryRuth Bank - Account View</div>
  <div class="grid">
    <div class="label">Customer</div><div class="value">${customer.full_name} (${customer.customer_id})</div>
    <div class="label">Account</div><div class="value">${account.account_type} ${account.masked_account_number}</div>
    <div class="label">Case</div><div class="value">${caseRow.case_id} - ${caseRow.category}</div>
    <div class="label">Balance</div><div class="value">$${Number(account.current_balance).toFixed(2)}</div>
    <div class="label">Recent item</div><div class="value">${transaction.description} / ${transaction.status}</div>
    <div class="label">Queue</div><div class="value">${caseRow.assigned_queue}</div>
  </div>
  <div class="notice">Synthetic mock screenshot. No live banking system is represented.</div>
</div>
</html>
`,
  };
}

async function writeCaseArtifacts(cases, customers, accounts, transactions) {
  for (const c of cases) {
    const dir = path.join(artifactsDir, "cases", c.case_id);
    await mkdirp(dir);
    const customer = customers.find((x) => x.customer_id === c.customer_id);
    const account = accounts.find((x) => x.account_id === c.account_id);
    const transaction = transactions.find((x) => x.transaction_id === c.related_transaction_id);
    const docs = caseArtifactText(c, customer, account, transaction);
    await fs.writeFile(path.join(dir, "chat_transcript.md"), docs.chat, "utf8");
    await fs.writeFile(path.join(dir, "email_thread.md"), docs.email, "utf8");
    await fs.writeFile(path.join(dir, "call_notes.md"), docs.callNotes, "utf8");
    await fs.writeFile(path.join(dir, "case_notes.md"), docs.caseNotes, "utf8");
    await fs.writeFile(path.join(dir, "statement_snippet.md"), docs.statementSnippet, "utf8");
    await fs.writeFile(path.join(dir, "agent_response_template.md"), docs.template, "utf8");
    await fs.writeFile(path.join(dir, "simple_account_screenshot.html"), docs.screenshot, "utf8");
  }
}

async function writeKbArtifacts(kbArticles) {
  const dir = path.join(artifactsDir, "knowledge_base");
  await mkdirp(dir);
  for (const article of kbArticles) {
    const cfg = categoryConfig[article.category];
    const text = `# ${article.title}

Article ID: ${article.article_id}
Category: ${article.category}
Audience: ${article.audience}
Last reviewed: ${article.last_reviewed}

## Purpose
${article.summary}

## Agent Procedure
1. Confirm the customer's identity using approved synthetic verification steps.
2. Review account status, case history, and related transactions.
3. Apply the category policy: ${cfg.next}
4. Document the decision, evidence, and any handoff queue.

## Customer-Safe Language
Use plain language. Acknowledge the concern. Explain the next step without promising outcomes that require operations review.

## Escalation
Escalate to ${cfg.queue} when documentation is incomplete, customer sentiment is high-risk, or the request exceeds frontline authority.

Synthetic article for testing only.
`;
    await fs.writeFile(path.join(dir, `${article.article_id}_${safeName(article.category)}.md`), text, "utf8");
  }
}

async function writeCategoryTemplates() {
  const dir = path.join(artifactsDir, "response_templates");
  await mkdirp(dir);
  for (const category of categories) {
    const cfg = categoryConfig[category];
    const text = `# ${category} Response Template

Hi {{customer_first_name}},

Thanks for reaching out about ${category}. I reviewed the available case details for account {{masked_account_number}}.

Per ${cfg.policy}, the next step is: ${cfg.next}

For security, please keep full account numbers, passwords, one-time codes, and full card numbers out of this conversation.

Thank you,
BerryRuth Bank Support
`;
    await fs.writeFile(path.join(dir, `${safeName(category)}.md`), text, "utf8");
  }
}

function summarizeBy(rows, field) {
  const counts = new Map();
  for (const row of rows) counts.set(row[field], (counts.get(row[field]) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([key, count]) => ({ [field]: key, count }));
}

function colName(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetWrite(sheet, rows, options = {}) {
  const headers = Object.keys(rows[0]);
  const values = [headers, ...rows.map((row) => headers.map((h) => row[h]))];
  const lastCol = colName(headers.length);
  sheet.getRange(`A1:${lastCol}${values.length}`).values = values;
  sheet.freezePanes.freezeRows(1);
  sheet.showGridLines = false;
  const header = sheet.getRange(`A1:${lastCol}1`);
  header.format.fill.color = "#143D59";
  header.format.font.color = "#FFFFFF";
  header.format.font.bold = true;
  header.format.wrapText = true;
  const used = sheet.getRange(`A1:${lastCol}${values.length}`);
  used.format.font.name = "Aptos";
  used.format.font.size = 10;
  used.format.borders = { preset: "outside", style: "thin", color: "#AAB7C4" };
  used.format.autofitColumns();
  if (options.wrapCols) {
    for (const c of options.wrapCols) sheet.getRange(`${colName(c)}:${colName(c)}`).format.wrapText = true;
  }
}

async function buildWorkbook(customers, accounts, transactions, cases, kbArticles, goldenAnswers) {
  const workbook = Workbook.create();
  const summary = workbook.worksheets.add("Summary");
  const customerSheet = workbook.worksheets.add("Customers");
  const accountSheet = workbook.worksheets.add("Accounts");
  const transactionSheet = workbook.worksheets.add("Transactions");
  const caseSheet = workbook.worksheets.add("Cases");
  const kbSheet = workbook.worksheets.add("KB Articles");
  const goldenSheet = workbook.worksheets.add("Golden Tests");
  const categorySheet = workbook.worksheets.add("Category Coverage");

  sheetWrite(customerSheet, customers);
  sheetWrite(accountSheet, accounts);
  sheetWrite(transactionSheet, transactions);
  sheetWrite(caseSheet, cases, { wrapCols: [11, 12, 13] });
  sheetWrite(kbSheet, kbArticles, { wrapCols: [6, 7] });
  sheetWrite(goldenSheet, goldenAnswers, { wrapCols: [4, 5, 6, 7, 8, 9, 10] });

  const categoryRows = categories.map((category) => ({
    category,
    cases: cases.filter((c) => c.category === category).length,
    kb_articles: kbArticles.filter((a) => a.category === category).length,
    golden_tests: goldenAnswers.filter((g) => g.category === category).length,
    owning_queue: categoryConfig[category].queue,
    policy: categoryConfig[category].policy,
  }));
  sheetWrite(categorySheet, categoryRows, { wrapCols: [5, 6] });

  const statusRows = summarizeBy(cases, "status");
  const channelRows = summarizeBy(cases, "channel");
  const summaryValues = [
    ["Customer Service Case Resolution Copilot - Synthetic Data Pack", "", "", ""],
    ["Generated", "2026-06-23", "Seed", "42075"],
    ["Dataset", "Target", "Actual", "Notes"],
    ["Customers", COUNTS.customers, customers.length, "Synthetic profiles only"],
    ["Accounts", COUNTS.accounts, accounts.length, "Two accounts per customer on average"],
    ["Transactions", COUNTS.transactions, transactions.length, "Posted and pending examples"],
    ["Customer service cases", COUNTS.cases, cases.length, "Nine support categories"],
    ["Knowledge-base articles", COUNTS.kbArticles, kbArticles.length, "Markdown policy articles included"],
    ["Golden-answer test cases", COUNTS.goldenAnswers, goldenAnswers.length, "Evaluation prompts and expected criteria"],
    ["Case evidence folders", COUNTS.cases, cases.length, "Chat, email, call notes, case notes, statement snippet, template, HTML screenshot"],
    ["", "", "", ""],
    ["Case Status", "Count", "", ""],
    ...statusRows.map((r) => [r.status, r.count, "", ""]),
    ["", "", "", ""],
    ["Channel", "Count", "", ""],
    ...channelRows.map((r) => [r.channel, r.count, "", ""]),
  ];
  summary.getRange(`A1:D${summaryValues.length}`).values = summaryValues;
  summary.getRange("A1:D1").merge();
  summary.getRange("A1").format.fill.color = "#143D59";
  summary.getRange("A1").format.font.color = "#FFFFFF";
  summary.getRange("A1").format.font.bold = true;
  summary.getRange("A1").format.font.size = 16;
  summary.getRange("A3:D3").format.fill.color = "#DDEAF3";
  summary.getRange("A3:D3").format.font.bold = true;
  summary.getRange("A12:D12").format.fill.color = "#DDEAF3";
  summary.getRange("A12:D12").format.font.bold = true;
  summary.getRange("A16:D16").format.fill.color = "#DDEAF3";
  summary.getRange("A16:D16").format.font.bold = true;
  summary.getRange(`A1:D${summaryValues.length}`).format.font.name = "Aptos";
  summary.getRange(`A1:D${summaryValues.length}`).format.borders = { preset: "outside", style: "thin", color: "#AAB7C4" };
  summary.getRange("B4:C10").setNumberFormat("#,##0");
  summary.getRange("A:D").format.autofitColumns();
  summary.getRange("A:A").format.columnWidth = 42;
  summary.getRange("B:C").format.columnWidth = 14;
  summary.getRange("D:D").format.columnWidth = 84;
  summary.getRange("D1:D20").format.wrapText = true;
  summary.showGridLines = false;

  await mkdirp(outputsDir);
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(path.join(outputsDir, "banking_case_resolution_copilot_synthetic_data.xlsx"));
  const preview = await workbook.render({ sheetName: "Summary", range: "A1:D20", scale: 2, format: "png" });
  await fs.writeFile(path.join(outputsDir, "summary_preview.png"), new Uint8Array(await preview.arrayBuffer()));
  const errors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 100 },
    summary: "final formula error scan",
  });
  await fs.writeFile(path.join(outputsDir, "workbook_formula_error_scan.ndjson"), errors.ndjson, "utf8");
}

async function writeReadme() {
  const readme = `# Banking Case Resolution Copilot Synthetic Data Pack

Generated: 2026-06-23

This bundle supports a mock banking operation environment for a Customer Service Case Resolution Copilot. All content is synthetic. It contains no real customers, no real accounts, no real transactions, and no live bank policy.

## Contents

- \`data/customers.csv\` - 200 synthetic customers
- \`data/accounts.csv\` - 400 synthetic accounts
- \`data/transactions.csv\` - 1,000 synthetic transactions
- \`data/customer_service_cases.csv\` - 100 synthetic customer service cases
- \`data/knowledge_base_articles.csv\` - 30 synthetic KB metadata rows
- \`data/golden_answer_tests.csv\` - 50 golden-answer evaluation cases
- \`artifacts/cases/CASE-xxxxx/\` - case-level chat transcripts, email threads, call notes, policy-linked case notes, statement snippets, response templates, and simple HTML account screenshots
- \`artifacts/knowledge_base/\` - Markdown policy articles
- \`artifacts/response_templates/\` - reusable category templates
- \`outputs/case_resolution_copilot/banking_case_resolution_copilot_synthetic_data.xlsx\` - formatted workbook copy

## Case Categories

${categories.map((c) => `- ${c}`).join("\n")}

## Recommended Retrieval Use

Index the CSV rows as structured data and the Markdown/HTML files as unstructured support artifacts. Use \`case_id\`, \`customer_id\`, \`account_id\`, \`transaction_id\`, and \`kb_article_id\` as join keys.
`;
  await fs.writeFile(path.join(rootDir, "README.md"), readme, "utf8");
}

async function writeManifest(rows) {
  const manifest = {
    generated_at: "2026-06-23T00:00:00-04:00",
    seed: 42075,
    synthetic_notice: "All records and artifacts are fictional and for testing only.",
    counts: {
      customers: rows.customers.length,
      accounts: rows.accounts.length,
      transactions: rows.transactions.length,
      customer_service_cases: rows.cases.length,
      knowledge_base_articles: rows.kbArticles.length,
      golden_answer_tests: rows.goldenAnswers.length,
      case_artifact_folders: rows.cases.length,
      category_templates: categories.length,
    },
    categories,
    join_keys: ["customer_id", "account_id", "transaction_id", "case_id", "kb_article_id"],
  };
  await fs.writeFile(path.join(rootDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

async function main() {
  await mkdirp(dataDir);
  await mkdirp(artifactsDir);
  await mkdirp(outputsDir);
  const customers = makeCustomers();
  const accounts = makeAccounts(customers);
  const transactions = makeTransactions(accounts);
  const kbArticles = makeKbArticles();
  const cases = makeCases(customers, accounts, transactions, kbArticles);
  const goldenAnswers = makeGoldenAnswers(cases);

  await writeCsv("customers.csv", customers);
  await writeCsv("accounts.csv", accounts);
  await writeCsv("transactions.csv", transactions);
  await writeCsv("customer_service_cases.csv", cases);
  await writeCsv("knowledge_base_articles.csv", kbArticles);
  await writeCsv("golden_answer_tests.csv", goldenAnswers);
  await writeCaseArtifacts(cases, customers, accounts, transactions);
  await writeKbArtifacts(kbArticles);
  await writeCategoryTemplates();
  await writeReadme();
  await writeManifest({ customers, accounts, transactions, cases, kbArticles, goldenAnswers });
  await buildWorkbook(customers, accounts, transactions, cases, kbArticles, goldenAnswers);

  console.log(JSON.stringify({
    ok: true,
    rootDir,
    counts: {
      customers: customers.length,
      accounts: accounts.length,
      transactions: transactions.length,
      cases: cases.length,
      kbArticles: kbArticles.length,
      goldenAnswers: goldenAnswers.length,
    },
  }, null, 2));
}

await main();
