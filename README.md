# Banking Case Resolution Copilot Synthetic Data Pack

Generated: 2026-06-23

This bundle supports a mock banking operation environment for a Customer Service Case Resolution Copilot. All content is synthetic. It contains no real customers, no real accounts, no real transactions, and no live bank policy.

## Contents

- `data/customers.csv` - 200 synthetic customers
- `data/accounts.csv` - 400 synthetic accounts
- `data/transactions.csv` - 1,000 synthetic transactions
- `data/customer_service_cases.csv` - 100 synthetic customer service cases
- `data/knowledge_base_articles.csv` - 30 synthetic KB metadata rows
- `data/golden_answer_tests.csv` - 50 golden-answer evaluation cases
- `artifacts/cases/CASE-xxxxx/` - case-level chat transcripts, email threads, call notes, policy-linked case notes, statement snippets, response templates, and simple HTML account screenshots
- `artifacts/knowledge_base/` - Markdown policy articles
- `artifacts/response_templates/` - reusable category templates
- `outputs/case_resolution_copilot/banking_case_resolution_copilot_synthetic_data.xlsx` - formatted workbook copy

## Case Categories

- overdraft fee reversal
- card replacement
- address change
- payment not posted
- account access issue
- wire transfer question
- loan payoff question
- dispute handoff
- complaint escalation

## Recommended Retrieval Use

Index the CSV rows as structured data and the Markdown/HTML files as unstructured support artifacts. Use `case_id`, `customer_id`, `account_id`, `transaction_id`, and `kb_article_id` as join keys.
