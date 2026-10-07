// Accounting Synchronization & Export Engine for Flas CRM.
// Generates verified import formats and payloads for:
// 1. Tally Prime (XML Sales Voucher)
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

export type AccountingSyncOptions = {
  companyName?: string;
  salesLedger?: string;
  taxLedger?: string;
  roundOffLedger?: string;
};

function escapeXml(unsafe: unknown): string {
  return String(unsafe ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeCsv(val: unknown): string {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Formats YYYY-MM-DD into Tally's YYYYMMDD date format. */
function tallyDate(isoDate: string): string {
  const clean = (isoDate ?? "").slice(0, 10).replace(/-/g, "");
  return clean || new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * 1. TALLY PRIME XML EXPORT
 * Produces an authentic Tally Prime XML Sales Voucher that can be loaded
 * into Tally via 'Import Data' -> 'Vouchers'.
 */
export function generateTallySalesXml(
  doc: SyncInvoiceDoc,
  items: SyncInvoiceItem[],
  options: AccountingSyncOptions = {},
): string {
  const companyName = options.companyName || "Flas CRM Company";
  const salesLedger = options.salesLedger || "Sales Account";
  const taxLedger = options.taxLedger || (doc.tax_label ? `${doc.tax_label} Output` : "Output VAT");
  const customerName =
    doc.customer_snapshot?.company ||
    doc.customer_snapshot?.name ||
    "Cash Customer";

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
          <VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
            <DATE>${dateStr}</DATE>
            <EFFECTIVEDATE>${dateStr}</EFFECTIVEDATE>
            <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${escapeXml(vchNumber)}</VOUCHERNUMBER>
            <REFERENCE>${escapeXml(doc.reference || vchNumber)}</REFERENCE>
            <PARTYLEDGERNAME>${escapeXml(customerName)}</PARTYLEDGERNAME>
            <BASICBUYERNAME>${escapeXml(customerName)}</BASICBUYERNAME>
            ${doc.customer_snapshot?.vat_number ? `<PARTYGSTIN>${escapeXml(doc.customer_snapshot.vat_number)}</PARTYGSTIN>` : ""}
            <NARRATION>${escapeXml(doc.notes || `Invoice ${vchNumber} generated via Flas CRM`)}</NARRATION>
            <ISINVOICE>Yes</ISINVOICE>

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
 * Standard QuickBooks Online CSV invoice format.
 */
export function generateQuickBooksCsv(doc: SyncInvoiceDoc, items: SyncInvoiceItem[]): string {
  const headers = [
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
      escapeCsv(doc.doc_number),
      escapeCsv(customerName),
      escapeCsv(doc.issue_date),
      escapeCsv(doc.due_date || doc.issue_date),
      escapeCsv(doc.payment_terms || "Net 30"),
      escapeCsv(item.name),
      escapeCsv(item.description || item.name),
      escapeCsv(item.quantity),
      escapeCsv(item.unit_price.toFixed(2)),
      escapeCsv(lineAmt),
      escapeCsv(doc.tax_label || "Tax"),
      escapeCsv(taxAmt),
      escapeCsv(doc.currency),
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
  options: AccountingSyncOptions = {},
): string {
  const salesLedger = options.salesLedger || "Sales";
  const customer = doc.customer_snapshot?.name || doc.customer_snapshot?.company || "Customer";
  const dateStr = doc.issue_date;
  const dueDateStr = doc.due_date || doc.issue_date;
  const docNum = doc.doc_number;
  const grandTotal = doc.grand_total.toFixed(2);

  const lines = [
    "!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tCLEAR\tTOPRINT\tDUEDATE\tTERMS",
    "!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tCLEAR\tQNTY\tPRICE\tINVITEM\tTAXABLE",
    "!ENDTRNS",
    `TRNS\t\tINVOICE\t${dateStr}\tAccounts Receivable\t${customer}\t${grandTotal}\t${docNum}\t${doc.notes || ""}\tN\tY\t${dueDateStr}\t${doc.payment_terms || ""}`,
  ];

  for (const item of items) {
    const itemTotal = (-item.line_total).toFixed(2);
    lines.push(
      `SPL\t\tINVOICE\t${dateStr}\t${salesLedger}\t${customer}\t${itemTotal}\t${docNum}\t${item.description || item.name}\tN\t-${item.quantity}\t${item.unit_price}\t${item.name}\tY`,
    );
  }

  if (doc.tax_total > 0) {
    const taxLedger = options.taxLedger || "Sales Tax Payable";
    lines.push(
      `SPL\t\tINVOICE\t${dateStr}\t${taxLedger}\t${customer}\t${(-doc.tax_total).toFixed(2)}\t${docNum}\t${doc.tax_label || "VAT"}\tN\t\t\t\tN`,
    );
  }

  lines.push("ENDTRNS");
  return lines.join("\n");
}

/**
 * 4. ZOHO BOOKS CSV EXPORT
 * Official Zoho Books Invoice import template format.
 */
export function generateZohoInvoiceCsv(doc: SyncInvoiceDoc, items: SyncInvoiceItem[]): string {
  const headers = [
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
      escapeCsv(doc.doc_number),
      escapeCsv(customerName),
      escapeCsv(doc.issue_date),
      escapeCsv(doc.due_date || doc.issue_date),
      escapeCsv(doc.due_date || doc.issue_date),
      escapeCsv(doc.currency),
      escapeCsv(item.name),
      escapeCsv(item.description || item.name),
      escapeCsv(item.quantity),
      escapeCsv(item.unit_price.toFixed(2)),
      escapeCsv(item.discount_amount ? item.discount_amount.toFixed(2) : "0"),
      escapeCsv(doc.tax_label || "VAT"),
      escapeCsv(item.tax_rate ?? 0),
      escapeCsv(doc.notes || ""),
      escapeCsv(doc.terms || ""),
    ];
    rows.push(row.join(","));
  }

  return rows.join("\n");
}

/**
 * 5. ZOHO BOOKS API JSON PAYLOAD
 * Formatted for the official Zoho Books REST API (POST /api/v3/invoices).
 */
export function generateZohoInvoiceJson(doc: SyncInvoiceDoc, items: SyncInvoiceItem[]): string {
  const payload = {
    customer_name:
      doc.customer_snapshot?.company || doc.customer_snapshot?.name || "Customer",
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
 * Formatted for Intuit QuickBooks Online v3 API (POST /v3/company/<id>/invoice).
 */
export function generateQuickBooksInvoiceJson(
  doc: SyncInvoiceDoc,
  items: SyncInvoiceItem[],
): string {
  const payload = {
    DocNumber: doc.doc_number,
    TxnDate: doc.issue_date,
    DueDate: doc.due_date || doc.issue_date,
    CustomerRef: {
      value: doc.customer_snapshot?.company || doc.customer_snapshot?.name || "Customer",
      name: doc.customer_snapshot?.company || doc.customer_snapshot?.name || "Customer",
    },
    CustomerMemo: {
      value: doc.notes || "Generated from Flas CRM",
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
