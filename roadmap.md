# Authentication reliability and company email auditing

- [x] Restore sign-in, registration, password recovery, and recovery-link password updates.
- [x] Add resend-verification with a visible cooldown and a maximum-attempt safeguard.
- [x] Add a tenant-aware authentication email audit for signup verification and password recovery events.
- [x] Show super admins accepted/rejected authentication email outcomes and timestamps per client company.
- Do not claim delivered/opened status because the email provider does not expose those outcomes.
- [x] Keep the Flas owner accounts separate from all client-company workspaces.
# Flas CRM Roadmap
## Open tasks
- [x] Resubmit add_secret form for platform credentials (user: "dont skip please submit") — form declined by user, can be reopened later.
- [x] Chatbot page: show a banner when the bot is inactive because instructions are short (< 20 chars) or greeting is empty.
- [x] Cast refresh_locked_until update in connections.server.ts so social connection health stops failing.
- [ ] Apply pending OAuth helper grants migration so social login/health permission errors stop.
- [ ] Make social accounts easier to connect (review ConnectBusiness UX).
- [ ] Connect real WhatsApp access token, phone number ID and app secret — pending user entering them in Secrets.
