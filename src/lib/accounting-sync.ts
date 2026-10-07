// Accounting Export Engine for Flas CRM.
// Generates verified import formats and payloads for:
// 1. Tally Prime (XML Sales Voucher & Quotation Voucher)
// 2. QuickBooks Online & Desktop (CSV / IIF / REST JSON)
// 3. Zoho Books (CSV / REST JSON)

export type SyncInvoiceDoc = {
  id: string;
  doc_number: string;
  kind?: string;
  issue_date: string;
  due_date?: string | null;
  currency: string;
  tax_label?: string | null;
  subtotal: number;
  tax_total: number;
  grand_total: number;
  paid_amount?: number;
  balance?: number;
  payment_terms?: string | null;
  reference?: string | null;
  po_number?: string | null;
  notes?: string | null;
  terms?: string | null;
  customer_snapshot?: {
    name?: string | null;
    company?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    vat_number?: string | null;
  } | null;
};

export type SyncInvoiceItem = {
  name: string;
  description?: string | null;
  sku?: string | null;
  quantity: number;
  unit?: string | null;
  unit_price: number;
  discount_amount?: number;
  tax_rate?: number;
  tax_amount?: number;
  line_total: number;
};

export type AccountingExportOptions = {
  companyName?: string;
  salesLedger?: string;
  taxLedger?: string;
  roundOffLedger?: string;
};

export type AccountingSyncOptions = AccountingExportOptions;

/**
 * Strips XML 1.0 disallowed control characters [\x00-\x08\x0B\x0C\x0E-\x1F]
 * and escapes standard XML reserved entities.
 */
export function escapeXml(unsafe: unknown): string {
  return String(unsafe ?? "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Sanitizes untrusted user strings against CSV formula injection (DDE / CSV Injection).
 * Prepend a single quote (') if untrusted text starts with =, +, -, @, \t, or \r.
 * Strict numeric figures (e.g. 100, -50.00, +25) are preserved without single quote.
 * Escapes quotes and wraps cells containing commas, quotes, or newlines in double quotes.
 */
export function sanitizeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  let s = String(val);
  if (s.length === 0) return "";

  // Pure numeric string with optional negative or positive sign (e.g. "-50.00", "120")
  if (/^\s*[+-]?\d+(\.\d+)?\s*$/.test(s)) {
    return s.trim();
  }

  // Prepend single quote if untrusted text starts with formula triggers
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }

  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * QuickBooks IIF format sanitization.
 * Replaces tab, newline, and control characters with space to prevent column/row corruption.
 */
export function escapeIif(val: unknown): string {
  return String(val ?? "")
    .replace(/[\x00-\x1F]+/g, " ")
    .trim();
}

/** Formats YYYY-MM-DD into Tally's YYYYMMDD date format. */
function tallyDate(isoDate: string): string {
  const clean = (isoDate ?? "").slice(0, 10).replace(/-/g, "");
  return clean || new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * 1. TALLY PRIME XML EXPORT
 * Produces an authentic Tally Prime XML Sales / Quotation Voucher that can be loaded
 * into Tally via 'Import Data' -> 'Vouchers'.
 */
export function generateTallySalesXml(
  doc: SyncInvoiceDoc,
  items: SyncInvoiceItem[],
  options: AccountingExportOptions = {},
): string {
  const companyName = options.companyName || "Flas CRM Company";
  const salesLedger = options.salesLedger || "Sales Account";
  const taxLedger = options.taxLedger || (doc.tax_label ? `${doc.tax_label} Output` : "Output VAT");
  const customerName =
    doc.customer_snapshot?.company ||
    doc.customer_snapshot?.name ||
    "Cash Customer";

  const isQuotation = doc.kind === "quotation";
  const voucherType = isQuotation ? "Quotation" : "Sales";
  const isInvoiceXml = isQuotation ? "No" : "Yes";
  const objView = isQuotation ? "" : ' OBJVIEW="Invoice Voucher View"';

  const dateStr = tallyDate(doc.issue_date);
  const vchNumber = doc.doc_number;
  const grandTotal = Number(doc.grand_total || 0).toFixed(2);
  const taxTotal = Number(doc.tax_total || 0).toFixed(2);
  const subtotal = Number(doc.subtotal || 0).toFixed(2);

  const inventoryEntries = items
    .map((item) => {
      const lineAmt = Number(item.line_total || item.quantity * item.unit_price).toFixed(2);
      const rate = Number(item.unit_price).toFixed(2);
      const qty = Number(item.quantity);
      const unit = item.unit || "Nos";
      return `
              <ALLINVENTORYENTRIES.LIST>
                <STOCKITEMNAME>${escapeXml(item.name)}</STOCKITEMNAME>
                <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                <RATE>${rate}/${escapeXml(unit)}</RATE>
                <AMOUNT>-${lineAmt}</AMOUNT>
                <ACTUALQTY>${qty} ${escapeXml(unit)}</ACTUALQTY>
                <BILLEDQTY>${qty} ${escapeXml(unit)}</BILLEDQTY>
                <ACCOUNTINGALLOCATIONS.LIST>
                  <LEDGERNAME>${escapeXml(salesLedger)}</LEDGERNAME>
                  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                  <AMOUNT>-${lineAmt}</AMOUNT>
                </ACCOUNTINGALLOCATIONS.LIST>
              </ALLINVENTORYENTRIES.LIST>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="${escapeXml(voucherType)}" ACTION="Create"${objView}>
            <DATE>${dateStr}</DATE>
            <EFFECTIVEDATE>${dateStr}</EFFECTIVEDATE>
            <VOUCHERTYPENAME>${escapeXml(voucherType)}</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${escapeXml(vchNumber)}</VOUCHERNUMBER>
            <REFERENCE>${escapeXml(doc.reference || vchNumber)}</REFERENCE>
            <PARTYLEDGERNAME>${escapeXml(customerName)}</PARTYLEDGERNAME>
            <BASICBUYERNAME>${escapeXml(customerName)}</BASICBUYERNAME>
            ${doc.customer_snapshot?.vat_number ? `<PARTYGSTIN>${escapeXml(doc.customer_snapshot.vat_number)}</PARTYGSTIN>` : ""}
            <NARRATION>${escapeXml(doc.notes || `${isQuotation ? "Quotation" : "Invoice"} ${vchNumber} generated via Flas CRM`)}</NARRATION>
            <ISINVOICE>${isInvoiceXml}</ISINVOICE>

            <!-- Customer / Debtor Ledger Entry (Debit) -->
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>${escapeXml(customerName)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>${grandTotal}</AMOUNT>
            </LEDGERENTRIES.LIST>

            <!-- Tax Ledger Entry (Credit) -->
            ${
              Number(taxTotal) > 0
                ? `
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>${escapeXml(taxLedger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>-${taxTotal}</AMOUNT>
            </LEDGERENTRIES.LIST>`
                : ""
            }

            <!-- Inventory Items -->
            ${inventoryEntries || `
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>${escapeXml(salesLedger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>-${subtotal}</AMOUNT>
            </LEDGERENTRIES.LIST>`}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`.trim();
}

/**
 * 2. QUICKBOOKS ONLINE CSV EXPORT
 * Standard QuickBooks Online CSV invoice or estimate format.
 */
export function generateQuickBooksCsv(doc: SyncInvoiceDoc, items: SyncInvoiceItem[]): string {
  const isQuotation = doc.kind === "quotation";
  const headers = isQuotation
    ? [
        "*EstimateNo",
        "*Customer",
        "*EstimateDate",
        "*ExpirationDate",
        "Terms",
        "Item(Product/Service)",
        "ItemDescription",
        "ItemQuantity",
        "ItemRate",
        "*ItemAmount",
        "ItemTaxCode",
        "ItemTaxAmount",
        "Currency",
      ]
    : [
        "*InvoiceNo",
        "*Customer",
        "*InvoiceDate",
        "*DueDate",
        "Terms",
        "Item(Product/Service)",
        "ItemDescription",
        "ItemQuantity",
        "ItemRate",
        "*ItemAmount",
        "ItemTaxCode",
        "ItemTaxAmount",
        "Currency",
      ];

  const customerName =
    doc.customer_snapshot?.company ||
    doc.customer_snapshot?.name ||
    "Customer";

  const rows: string[] = [headers.join(",")];

  for (const item of items) {
    const lineAmt = (item.quantity * item.unit_price).toFixed(2);
    const taxAmt = (item.tax_amount || 0).toFixed(2);
    const row = [
      sanitizeCsvCell(doc.doc_number),
      sanitizeCsvCell(customerName),
      sanitizeCsvCell(doc.issue_date),
      sanitizeCsvCell(doc.due_date || doc.issue_date),
      sanitizeCsvCell(doc.payment_terms || "Net 30"),
      sanitizeCsvCell(item.name),
      sanitizeCsvCell(item.description || item.name),
      sanitizeCsvCell(item.quantity),
      sanitizeCsvCell(item.unit_price.toFixed(2)),
      sanitizeCsvCell(lineAmt),
      sanitizeCsvCell(doc.tax_label || "Tax"),
      sanitizeCsvCell(taxAmt),
      sanitizeCsvCell(doc.currency),
    ];
    rows.push(row.join(","));
  }

  return rows.join("\n");
}

/**
 * 3. QUICKBOOKS DESKTOP IIF EXPORT
 * Native Intuit Interchange Format (.iif) for direct QuickBooks import.
 */
export function generateQuickBooksIif(
  doc: SyncInvoiceDoc,
  items: SyncInvoiceItem[],
  options: AccountingExportOptions = {},
): string {
  const isQuotation = doc.kind === "quotation";
  const trnsType = isQuotation ? "ESTIMATE" : "INVOICE";
  const salesLedger = options.salesLedger || "Sales";
  const customer = escapeIif(
    doc.customer_snapshot?.name || doc.customer_snapshot?.company || "Customer",
  );
  const dateStr = escapeIif(doc.issue_date);
  const dueDateStr = escapeIif(doc.due_date || doc.issue_date);
  const docNum = escapeIif(doc.doc_number);
  const memo = escapeIif(doc.notes || (isQuotation ? "Quotation" : "Invoice"));
  const grandTotal = doc.grand_total.toFixed(2);

  const lines = [
    "!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tCLEAR\tTOPRINT\tDUEDATE\tTERMS",
    "!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tCLEAR\tQNTY\tPRICE\tINVITEM\tTAXABLE",
    "!ENDTRNS",
    `TRNS\t\t${trnsType}\t${dateStr}\tAccounts Receivable\t${customer}\t${grandTotal}\t${docNum}\t${memo}\tN\tY\t${dueDateStr}\t${escapeIif(doc.payment_terms || "")}`,
  ];

  for (const item of items) {
    const itemTotal = (-item.line_total).toFixed(2);
    lines.push(
      `SPL\t\t${trnsType}\t${dateStr}\t${escapeIif(salesLedger)}\t${customer}\t${itemTotal}\t${docNum}\t${escapeIif(item.description || item.name)}\tN\t-${item.quantity}\t${item.unit_price}\t${escapeIif(item.name)}\tY`,
    );
  }

  if (doc.tax_total > 0) {
    const taxLedger = options.taxLedger || "Sales Tax Payable";
    lines.push(
      `SPL\t\t${trnsType}\t${dateStr}\t${escapeIif(taxLedger)}\t${customer}\t${(-doc.tax_total).toFixed(2)}\t${docNum}\t${escapeIif(doc.tax_label || "VAT")}\tN\t\t\t\tN`,
    );
  }

  lines.push("ENDTRNS");
  return lines.join("\n");
}

/**
 * 4. ZOHO BOOKS CSV EXPORT
 * Official Zoho Books Invoice / Estimate import template format.
 */
export function generateZohoInvoiceCsv(doc: SyncInvoiceDoc, items: SyncInvoiceItem[]): string {
  const isQuotation = doc.kind === "quotation";
  const headers = isQuotation
    ? [
        "Estimate Number",
        "Customer Name",
        "Estimate Date",
        "Expiry Date",
        "Expected Payment Date",
        "Currency Code",
        "Item Name",
        "Item Desc",
        "Quantity",
        "Rate",
        "Discount",
        "Tax Name",
        "Tax Percentage",
        "Notes",
        "Terms & Conditions",
      ]
    : [
        "Invoice Number",
        "Customer Name",
        "Invoice Date",
        "Due Date",
        "Expected Payment Date",
        "Currency Code",
        "Item Name",
        "Item Desc",
        "Quantity",
        "Rate",
        "Discount",
        "Tax Name",
        "Tax Percentage",
        "Notes",
        "Terms & Conditions",
      ];

  const customerName =
    doc.customer_snapshot?.company ||
    doc.customer_snapshot?.name ||
    "Customer";

  const rows: string[] = [headers.join(",")];

  for (const item of items) {
    const row = [
      sanitizeCsvCell(doc.doc_number),
      sanitizeCsvCell(customerName),
      sanitizeCsvCell(doc.issue_date),
      sanitizeCsvCell(doc.due_date || doc.issue_date),
      sanitizeCsvCell(doc.due_date || doc.issue_date),
      sanitizeCsvCell(doc.currency),
      sanitizeCsvCell(item.name),
      sanitizeCsvCell(item.description || item.name),
      sanitizeCsvCell(item.quantity),
      sanitizeCsvCell(item.unit_price.toFixed(2)),
      sanitizeCsvCell(item.discount_amount ? item.discount_amount.toFixed(2) : "0"),
      sanitizeCsvCell(doc.tax_label || "VAT"),
      sanitizeCsvCell(item.tax_rate ?? 0),
      sanitizeCsvCell(doc.notes || ""),
      sanitizeCsvCell(doc.terms || ""),
    ];
    rows.push(row.join(","));
  }

  return rows.join("\n");
}

/**
 * 5. ZOHO BOOKS API JSON PAYLOAD
 * Formatted for the official Zoho Books REST API (POST /api/v3/invoices or /estimates).
 */
export function generateZohoInvoiceJson(doc: SyncInvoiceDoc, items: SyncInvoiceItem[]): string {
  const isQuotation = doc.kind === "quotation";
  const customerName =
    doc.customer_snapshot?.company || doc.customer_snapshot?.name || "Customer";

  const payload = isQuotation
    ? {
        customer_name: customerName,
        estimate_number: doc.doc_number,
        date: doc.issue_date,
        expiry_date: doc.due_date || doc.issue_date,
        currency_code: doc.currency,
        notes: doc.notes || undefined,
        terms: doc.terms || undefined,
        line_items: items.map((i) => ({
          name: i.name,
          description: i.description || undefined,
          rate: i.unit_price,
          quantity: i.quantity,
          item_total: i.line_total,
          tax_name: doc.tax_label || "VAT",
          tax_percentage: i.tax_rate ?? 0,
        })),
      }
    : {
        customer_name: customerName,
        invoice_number: doc.doc_number,
        date: doc.issue_date,
        due_date: doc.due_date || doc.issue_date,
        currency_code: doc.currency,
        payment_terms_label: doc.payment_terms || "Net 30",
        notes: doc.notes || undefined,
        terms: doc.terms || undefined,
        line_items: items.map((i) => ({
          name: i.name,
          description: i.description || undefined,
          rate: i.unit_price,
          quantity: i.quantity,
          item_total: i.line_total,
          tax_name: doc.tax_label || "VAT",
          tax_percentage: i.tax_rate ?? 0,
        })),
      };
  return JSON.stringify(payload, null, 2);
}

/**
 * 6. QUICKBOOKS ONLINE REST API JSON PAYLOAD
 * Formatted for Intuit QuickBooks Online v3 API (POST /v3/company/<id>/invoice or /estimate).
 */
export function generateQuickBooksInvoiceJson(
  doc: SyncInvoiceDoc,
  items: SyncInvoiceItem[],
): string {
  const isQuotation = doc.kind === "quotation";
  const customerName =
    doc.customer_snapshot?.company || doc.customer_snapshot?.name || "Customer";

  const payload = {
    DocNumber: doc.doc_number,
    TxnDate: doc.issue_date,
    ...(isQuotation
      ? { ExpirationDate: doc.due_date || doc.issue_date }
      : { DueDate: doc.due_date || doc.issue_date }),
    CustomerRef: {
      value: customerName,
      name: customerName,
    },
    CustomerMemo: {
      value:
        doc.notes ||
        (isQuotation
          ? "Quotation generated from Flas CRM"
          : "Invoice generated from Flas CRM"),
    },
    Line: items.map((i) => ({
      DetailType: "SalesItemLineDetail",
      Amount: i.line_total,
      Description: i.description || i.name,
      SalesItemLineDetail: {
        ItemRef: { name: i.name },
        UnitPrice: i.unit_price,
        Qty: i.quantity,
        TaxCodeRef: { value: doc.tax_label || "TAX" },
      },
    })),
  };
  return JSON.stringify(payload, null, 2);
}
