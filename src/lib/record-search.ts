/*
 * The record half of search (Ctrl K): contacts, products and articles that match
 * what was typed.
 *
 * It only asks the database about a kind of record when the person's role may
 * open the screen that record lives on (searchableRecords, lib/permissions.ts).
 * An SEO editor therefore gets no customer results, and the contacts query is
 * not even sent -- a hidden result is not the same as a query that never ran,
 * and only the second cannot leak. Row-level security still scopes whatever is
 * asked to the signed-in company; this is about not asking.
 *
 * A query that fails is not a query that found nothing. An error, a dropped
 * connection or a client that throws is reported in `failed` (which kinds could
 * not be searched) so the screen can say so, instead of showing "No matches
 * found" for a search that never ran. The kinds that did answer are still
 * returned, so one failing table does not hide the other two.
 *
 * The component maps the rows to what it shows. This is a plain function of a
 * client so it can be tested with a double that records which tables it was asked.
 */
import type { supabase } from "@/integrations/supabase/client";
import { searchableRecords, type RecordKind } from "./permissions";

type Client = Pick<typeof supabase, "from">;

export type ContactRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
};
export type ProductRow = { id: string; title: string; sku: string | null };
export type ArticleRow = { id: string; title: string; status: string };
export type RecordRows = {
  contacts: ContactRow[];
  products: ProductRow[];
  articles: ArticleRow[];
  /** The kinds that were searched but could not be read. Empty when everything answered. */
  failed: RecordKind[];
};

/** What a search that may look at nothing finds. */
export const NO_RECORDS: RecordRows = { contacts: [], products: [], articles: [], failed: [] };

type Answer<T> = { rows: T[]; failed: boolean };

/**
 * Runs one query. A database error, a rejection or a throw all come back as
 * failed with no rows; none of them is turned into an empty list. null means the
 * kind was not asked for (the role cannot open that screen).
 */
async function ask<T>(
  run: (() => PromiseLike<{ data: T[] | null; error: unknown }>) | null,
): Promise<Answer<T> | null> {
  if (!run) return null;
  try {
    const { data, error } = await run();
    if (error || !data) return { rows: [], failed: true };
    return { rows: data, failed: false };
  } catch {
    return { rows: [], failed: true };
  }
}

/** Fewer characters than this is not a search worth sending. */
export const MIN_RECORD_TERM = 2;

export async function searchRecords(
  client: Client,
  term: string,
  role: string | null | undefined,
): Promise<RecordRows> {
  const text = term.trim();
  if (text.length < MIN_RECORD_TERM) return NO_RECORDS;
  const allowed = searchableRecords(role);
  if (!allowed.contacts && !allowed.products && !allowed.articles) return NO_RECORDS;

  const like = `%${text}%`;
  // PostgREST's .or() string splits on commas/parens, so raw user input could
  // inject extra filter clauses (e.g. a search term containing a comma).
  // Wrapping the value in double quotes (escaping any inside it) is PostgREST's
  // documented way to pass a literal value through.
  const likeSafe = `"${like.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

  const [contacts, products, articles] = await Promise.all([
    ask<ContactRow>(
      allowed.contacts
        ? () =>
            client
              .from("contacts")
              .select("id, name, phone, email, company")
              .or(
                `name.ilike.${likeSafe},phone.ilike.${likeSafe},email.ilike.${likeSafe},company.ilike.${likeSafe}`,
              )
              .limit(6)
        : null,
    ),
    ask<ProductRow>(
      allowed.products
        ? () => client.from("products").select("id, title, sku").ilike("title", like).limit(5)
        : null,
    ),
    ask<ArticleRow>(
      allowed.articles
        ? () =>
            client.from("seo_articles").select("id, title, status").ilike("title", like).limit(5)
        : null,
    ),
  ]);

  const failed: RecordKind[] = [];
  if (contacts?.failed) failed.push("contacts");
  if (products?.failed) failed.push("products");
  if (articles?.failed) failed.push("articles");

  return {
    contacts: contacts?.rows ?? [],
    products: products?.rows ?? [],
    articles: articles?.rows ?? [],
    failed,
  };
}
