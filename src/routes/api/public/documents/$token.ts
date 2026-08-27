// Serves the official PDF for a finalised document to whoever holds the share
// token. Read-only; regenerated on demand so a PAID stamp always reflects
// reality.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/documents/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const token = params.token;
        if (!token || token.length < 16 || token.length > 80) {
          return new Response("Not found", { status: 404 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: doc } = await supabaseAdmin
          .from("sales_documents")
          .select("id, kind, doc_number, finalized_at")
          .eq("share_token", token)
          .maybeSingle();
        if (!doc || !doc.finalized_at) return new Response("Not found", { status: 404 });

        try {
          const { renderDocumentPdf } = await import("@/lib/billing.server");
          const { bytes } = await renderDocumentPdf(supabaseAdmin, doc.id, {});
          return new Response(bytes as unknown as BodyInit, {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `inline; filename="${doc.kind}-${doc.doc_number}.pdf"`,
              "Cache-Control": "no-store",
            },
          });
        } catch (e) {
          console.error("[documents] pdf render failed", e);
          return new Response("Could not generate the PDF", { status: 500 });
        }
      },
    },
  },
});
