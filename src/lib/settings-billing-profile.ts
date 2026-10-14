import { z } from "zod";
export const EMPTY_BILLING_PROFILE = {
  legalName: "",
  tradeName: "",
  trn: "",
  regNo: "",
  taxLabel: "VAT",
  taxRate: "0",
  address: "",
  phone: "",
  email: "",
  website: "",
  paymentTerms: "",
  paymentUrl: "",
};
export type BillingProfileDraft = typeof EMPTY_BILLING_PROFILE;
export function billingProfileDraft(row: Record<string, unknown> | null): BillingProfileDraft {
  return {
    legalName: String(row?.["legal_name"] ?? ""),
    tradeName: String(row?.["trade_name"] ?? ""),
    trn: String(row?.["tax_registration_number"] ?? row?.["vat_number"] ?? ""),
    regNo: String(row?.["registration_number"] ?? ""),
    taxLabel: String(row?.["tax_label"] ?? "VAT"),
    taxRate: String(row?.["default_tax_rate"] ?? 0),
    address: String(row?.["address"] ?? ""),
    phone: String(row?.["phone"] ?? ""),
    email: String(row?.["email"] ?? ""),
    website: String(row?.["website"] ?? ""),
    paymentTerms: String(row?.["default_payment_terms"] ?? ""),
    paymentUrl: String(row?.["online_payment_url"] ?? ""),
  };
}
function isPublicLink(value: string, httpsOnly: boolean) {
  if (!value.trim()) return true;
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.protocol === "https:" || (!httpsOnly && url.protocol === "http:"))
    );
  } catch {
    return false;
  }
}
export function billingProfileProblem(
  value: BillingProfileDraft,
): "taxRate" | "email" | "website" | "paymentUrl" | null {
  const rate = Number(value.taxRate);
  if (!value.taxRate.trim() || !Number.isFinite(rate) || rate < 0 || rate > 100) return "taxRate";
  if (value.email.trim() && !z.string().email().safeParse(value.email.trim()).success)
    return "email";
  if (!isPublicLink(value.website.trim(), false)) return "website";
  if (!isPublicLink(value.paymentUrl.trim(), true)) return "paymentUrl";
  return null;
}
export function billingProfilePatch(value: BillingProfileDraft) {
  const problem = billingProfileProblem(value);
  if (problem) throw new Error(`Invalid billing profile field: ${problem}`);
  return {
    legal_name: value.legalName.trim() || null,
    trade_name: value.tradeName.trim() || null,
    tax_registration_number: value.trn.trim() || null,
    vat_number: value.trn.trim() || null,
    registration_number: value.regNo.trim() || null,
    tax_label: value.taxLabel.trim() || "VAT",
    default_tax_rate: Number(value.taxRate),
    address: value.address.trim() || null,
    phone: value.phone.trim() || null,
    email: value.email.trim() || null,
    website: value.website.trim() || null,
    default_payment_terms: value.paymentTerms.trim() || null,
    online_payment_url: value.paymentUrl.trim() || null,
  };
}
