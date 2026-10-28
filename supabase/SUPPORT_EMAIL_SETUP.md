# ElectroStock support email setup

The Support Centre stores tickets and replies in Supabase. Email notifications use the authenticated `notify-support-email` Edge Function and Brevo's transactional email API.

## 1. Choose and verify the email addresses

- `SUPPORT_EMAIL`: the inbox that should receive new customer tickets and customer follow-up messages.
- `BREVO_SENDER_EMAIL`: a sender address verified in your Brevo account.
- `BREVO_SENDER_NAME`: optional; defaults to `ElectroStock Support`.
- `BREVO_API_KEY`: a Brevo API key with permission to send transactional email.
- `SUPPORT_TICKET_URL`: optional; defaults to `https://electrostock-tan.vercel.app`.

Do not put the Brevo API key or Supabase service-role key in `app.js`, `config.js`, Vercel frontend variables, or any public repository file. The function uses Supabase's server-side `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` environment values.

## 2. Deploy the Edge Function

Committing this folder to GitHub does not deploy a Supabase Edge Function automatically.

In the Supabase Dashboard for project `gldzrhocqlefedoykfdr`, open **Edge Functions** and create/deploy a function named `notify-support-email`. Use the source in `supabase/functions/notify-support-email/index.ts`. If your dashboard editor requires creating a function from the editor, copy the entire file into its `index.ts` and deploy it.

Keep JWT verification enabled for this function. It must only be invoked by signed-in ElectroStock users.

## 3. Add function secrets

In the Supabase Dashboard, open **Edge Functions → Secrets** (or the project's function secrets settings) and add:

- `BREVO_API_KEY` = your Brevo API key
- `SUPPORT_EMAIL` = your chosen support inbox
- `BREVO_SENDER_EMAIL` = the verified sender email in Brevo
- `BREVO_SENDER_NAME` = `ElectroStock Support` (optional)
- `SUPPORT_TICKET_URL` = `https://electrostock-tan.vercel.app` (optional)

Supabase normally supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. If the project does not supply one, add the matching project value through Supabase's secrets interface. Never share or commit the service-role key.

## 4. Test

After Vercel finishes deploying the latest `app.js`, sign in to ElectroStock and submit a test ticket. Confirm that the ticket is saved in Support Centre and the notification arrives in `SUPPORT_EMAIL`. Then reply as the platform support administrator and confirm the customer receives an email at the address on their Supabase Auth account.

If the ticket saves but email fails, the app shows a notification error; inspect the `notify-support-email` function logs and verify the Brevo sender and secrets. Replies typed in the Support Centre are stored in the ticket conversation. Replies sent manually from your email inbox are not automatically synchronized back into ElectroStock.
