# Two-factor recovery runbook (for Flas platform staff)

Written for PR #68, 17 October 2026. Not verified live: nobody followed these steps against the real Supabase project, and the dashboard wording below is from memory and may differ by version.

## When you need this

Once #68 is live, a password alone no longer gets anyone into an account that has two-factor turned on. That is the point, and it has a cost: **there is no way to get in without the authenticator app, and no way to reset it inside FLAS.** There are no backup codes. You need this runbook when:

1. **A person lost their phone, or changed it** without moving their authenticator app. They reach the code prompt and cannot pass it.
2. **A person did not turn two-factor on, and is now stuck at a code prompt.** Someone with only their password signed in, enrolled their own phone, and the real owner's next sign-in ends at the prompt. This is possible because Auth lets a password-only session enrol a factor on an account that has none. Treat it as a **possible account takeover**, not a lost phone (see "If you suspect someone else did it").

## Who may do this

Only people with access to the Supabase dashboard of the FLAS project (the project owner and named platform staff). The company's own admins cannot do it: there is no reset button in FLAS yet.

## Step 1: confirm who is asking, before touching anything

Removing the factor turns the account back into "password only". Anyone who can convince you to do it has just taken that account. So:

- **Never** act on a request whose only proof is the email or message that asked. Use a way to reach the person that you already had before the request: the phone number on the contract, or another admin of the same company you already know.
- Ask the **company's other admin** (or the account manager who owns the relationship) to confirm in writing that the person is who they say and really lost access. For a company with a single admin, call the number on file.
- Ask something only the owner would know (the last invoice number, the name of a connected WhatsApp number). Do not accept a code, a password or a link from them for this: you never need one.
- For the **platform super admin** account, two members of staff approve and the second one checks the first one's steps.
- Check the company's audit log (Settings, Audit log, as that company's admin, or in the database: `select created_at, actor_label, action, entity_id from audit_log where action = 'mfa.enabled' order by created_at desc;`). After #68 there is an entry "Two-step sign-in was turned on" with the person's address whenever a factor was turned on **through the FLAS security card**. If the entry is dated just before the complaint, and the person did not do it, go to "If you suspect someone else did it". An enrolment made by calling Auth's API directly leaves **no** entry.

## Step 2: look at the factor first (read-only)

In the Supabase SQL editor:

```sql
select f.id, f.factor_type, f.status, f.created_at, f.updated_at
from auth.mfa_factors f
join auth.users u on u.id = f.user_id
where u.email = '<the person''s address>';
```

Write down what you see (id, status, dates). A factor created and verified a few minutes before the complaint, by someone who is not the owner, is the takeover case.

## Step 3: remove the factor

Any one of these. Prefer the first.

1. **Dashboard:** Authentication, Users, open the person, and use the action that removes their MFA factors (the wording may be "Remove MFA factors").
2. **Admin API** (service-role key, never in a browser or a chat): `DELETE {SUPABASE_URL}/auth/v1/admin/users/{user_id}/factors/{factor_id}`. In supabase-js: `supabase.auth.admin.mfa.deleteFactor({ id: factorId, userId })`.
3. **SQL, by the project owner only**, when the others are not available: `delete from auth.mfa_factors where id = '<factor id from step 2>';` (challenges for that factor go with it). Delete one factor by its id, not every factor of everybody who matches a pattern.

Then check by repeating the query in step 2: no row for that factor.

## Step 4: sessions

Removing the factor does not end sessions that already entered a code. If you suspect someone else did it, also end the person's sessions in the dashboard (Authentication, Users, the sign-out action for that user) and set a new password for them by sending the normal "Forgot password" email to the address on file. The password-reset page now takes the person through their code first **if they have a factor**, so do this **after** step 3.

## What the person sees afterwards

- Their next sign-in with the password goes straight into FLAS, with **no code prompt**, exactly as before they used two-factor.
- If they were sitting at the code prompt: press **Back**, then sign in again.
- A browser that was already signed in finds out within about a minute (the server) or at its next session refresh (the page). Nothing is lost: it is just no longer asked for a code.
- Their old authenticator entry no longer works and can be deleted from their phone. To turn two-factor on again: Settings, Security, set up. It applies at once. Tell them to do it straight away, and to keep the phone safe: **there are still no backup codes.**

## If you suspect someone else did it

1. Do not hand over anything to whoever asked. Contact the real owner by the way you already had.
2. Remove the factor (step 3), end the sessions and reset the password (step 4).
3. Read the audit log of that company for the time between the unexpected enrolment and now (messages exported, API keys created, contacts exported) and tell the company admin what you find.
4. Write down what happened (below).

## Write it down

The removal is a dashboard action: **FLAS does not record it.** Keep your own note: who asked, how you checked who they were, who removed the factor, when, and which factor id. If the Supabase project keeps authentication logs, note the time so they can be found.

## Not built yet (follow-ups)

- A "reset two-factor" action for the platform super admin, with its own audit entry.
- Email to the account owner when two-factor is turned on or removed (email sending is not connected for this).
- Backup codes, and a warning in the security card at set-up: "if you lose your authenticator app…".
- An entry for an enrolment done by calling Auth's API directly: needs a database trigger on `auth.mfa_factors`, which is a migration.
- The audit log row to read "Two-step sign-in was turned on for {email}" in one sentence: the card shows the address in the next column today, and the card belongs to the Settings work.
- Requiring admins and the super admin to turn two-factor on.
- The database itself does not ask for the code (see the "Not covered: direct database access" section of PR #68): that is the next PR.

## Before #68 goes live

Run this read-only query once and tell the people it lists that their next page load will ask for a code. Confirm that the project owner can open the dashboard and remove a factor (do not remove anyone's):

```sql
select u.email, f.factor_type, f.status, f.created_at
from auth.mfa_factors f
join auth.users u on u.id = f.user_id
order by f.created_at;
```
