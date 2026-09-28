/** Body-only positional templates. Unsupported formats fail before delivery. */
export function templateParameterCount(body: string): number {
  const placeholders = [...body.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map((m) => (m[1] ?? "").trim());
  if (placeholders.some((value) => !/^[1-9]\d*$/.test(value))) {
    throw new Error(
      "This template uses named variables, which this composer does not support yet.",
    );
  }
  const indexes = [...new Set(placeholders.map(Number))].sort((a, b) => a - b);
  if (indexes.length > 10 || indexes.some((value, index) => value !== index + 1)) {
    throw new Error("This template needs consecutive variables from {{1}} to {{10}} at most.");
  }
  return indexes.length;
}

export function renderTemplateBody(body: string, variables: string[]): string {
  const count = templateParameterCount(body);
  if (variables.length !== count || variables.some((v) => !v.trim() || v.length > 500)) {
    throw new Error(`Fill all ${count} template variables before sending.`);
  }
  return body.replace(/{{\s*([1-9]\d*)\s*}}/g, (_, index: string) => variables[Number(index) - 1]!);
}
