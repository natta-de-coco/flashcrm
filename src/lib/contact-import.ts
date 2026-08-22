// Client-safe CSV/line parser + strict validator for contact imports,
// with row-level error reporting for the preview step.

export type ParsedRow = {
  line: number;
  name: string;
  phone: string | null;
  email: string | null;
  errors: string[];
};

const PHONE_RE = /^\+?[0-9][0-9\s().-]{5,19}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Parses pasted text or a CSV file into validated rows. */
export function parseContactImport(text: string): ParsedRow[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // Drop a header row like "name,phone,email" if present.
  if (lines[0] && /name/i.test(lines[0]) && /(phone|number|email)/i.test(lines[0])) {
    lines.shift();
  }

  const seenPhones = new Map<string, number>();
  const seenEmails = new Map<string, number>();

  return lines.map((line, index) => {
    const [a = "", b = "", c = ""] = line.split(/[,\t;]/).map((p) => p.trim());
    const phoneish = (v: string) => PHONE_RE.test(v);

    let name = a;
    let phone = b || null;
    let email = c || null;
    if (phoneish(a) && !b) {
      name = "";
      phone = a;
    } else if (phoneish(a) && phoneish(b)) {
      name = "";
      phone = a;
      email = null;
    }

    const errors: string[] = [];
    const lineNo = index + 1;

    if (name && name.length > 120) errors.push("Name is longer than 120 characters");
    if (phone && !phoneish(phone)) errors.push(`"${phone}" is not a valid phone number`);
    if (email && !EMAIL_RE.test(email)) errors.push(`"${email}" is not a valid email address`);
    if (!phone && !email) errors.push("Row needs at least a phone number or an email");

    if (phone && phoneish(phone)) {
      const normalized = phone.replace(/[\s().-]/g, "");
      const firstLine = seenPhones.get(normalized);
      if (firstLine !== undefined) errors.push(`Duplicate phone of line ${firstLine}`);
      else seenPhones.set(normalized, lineNo);
    }
    if (email && EMAIL_RE.test(email)) {
      const lower = email.toLowerCase();
      const firstLine = seenEmails.get(lower);
      if (firstLine !== undefined) errors.push(`Duplicate email of line ${firstLine}`);
      else seenEmails.set(lower, lineNo);
    }

    return { line: lineNo, name: name || phone || email || "", phone, email, errors };
  });
}

export function validRows(rows: ParsedRow[]): ParsedRow[] {
  return rows.filter((r) => r.errors.length === 0);
}
