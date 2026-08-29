# Authentication reliability and company email auditing

- Restore sign-in, registration, password recovery, and recovery-link password updates.
- Add resend-verification with a visible cooldown and a maximum-attempt safeguard.
- Add a tenant-aware authentication email audit for signup verification and password recovery events.
- Show super admins email outcomes and timestamps per client company; distinguish accepted, rejected, bounced, complained, suppressed, and rate-limited states.
- Do not claim delivered/opened status because the email provider does not expose those outcomes.
- Keep the Flas owner accounts separate from all client-company workspaces.
# Flas CRM Roadmap
