# BerryRuth Bank Loan Origination Documents Repository

Synthetic document repository for loan origination automation demos.

## Contents

- 50 loan packages tied to BerryRuth Bank CRM customer IDs.
- 350 text-based mock documents.
- Every document includes CRM match fields: customer ID, full name, email, phone, address, segment, household fields, credit score, and risk tier.
- Documents are Markdown files so data extraction can run without OCR.

## Document Types

| Document type | Demo use |
| --- | --- |
| Loan application | Data extraction |
| Paystub | Income verification |
| Bank statements | Asset verification |
| W-2 or 1099 summary | Income validation |
| Tax return summary | Income validation |
| Purchase contract | Property/loan validation |
| Appraisal summary | Property valuation |

## Index Files

- `manifest.csv`: spreadsheet-friendly document inventory.
- `manifest.json`: app/API-friendly document inventory.
- `extraction_schema.json`: suggested fields for UiPath extraction and validation.

## Folder Structure

```
loan_origination_documents/
  README.md
  manifest.csv
  manifest.json
  extraction_schema.json
  packages/
    LOAN-00001_CUST-00001/
      LOAN-00001_CUST-00001_loan_application.md
      ...
```

Synthetic test data only. No real customer, income, tax, property, or banking records are included.
