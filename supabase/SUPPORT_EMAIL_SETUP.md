# ElectroStock support email setup (Gmail)

ElectroStock keeps support tickets and replies in Supabase. Email notifications are sent through Google Apps Script using your Gmail account; Brevo is not required.

## 1. Create the Gmail sender script

1. Sign in to the Google account for `electrostock.zyx@gmail.com`.
2. Open https://script.google.com/ and choose **New project**.
3. Open the file `google-apps-script/SupportEmail.gs` in this GitHub repository, copy its entire contents, and replace the default code in the Apps Script editor with it.
4. In Apps Script, open **Project Settings** (gear icon) → **Script Properties** → **Add script property**. Add:
   - Property: `SUPPORT_EMAIL`
   - Value: `electrostock.zyx@gmail.com`
5. Add a second script property:
   - Property: `SUPPORT_WEBHOOK_SECRET`
   - Value: create a long, random secret of your own (at least 32 characters). Do not put this value in GitHub or send it in chat. You will enter the exact same value in Supabase in Step 3.
6. Click **Deploy → New deployment**. Select the gear beside type and choose **Web app**.
7. Set **Execute as** to **Me** and **Who has access** to **Anyone**, then click **Deploy** and authorize the requested Gmail permissions.
8. Copy the Web app URL ending in `/exec`. This is the URL for Supabase. Do not use the Apps Script editor URL.

The script is a small email sender. It checks the shared secret before sending any email. Keep that secret private.

## 2. Deploy the Supabase Edge Function

Committing code to GitHub does not automatically deploy a Supabase Edge Function.

1. Open the Supabase dashboard for project `gldzrhocqlefedoykfdr`: https://supabase.com/dashboard/project/gldzrhocqlefedoykfdr/functions
2. Create or open a function named `notify-support-email`.
3. Copy the entire source from [notify-support-email/index.ts](https://github.com/aderibigbetoluwalopestephen-maker/ElectroStock/blob/main/supabase/functions/notify-support-email/index.ts) into its `index.ts` editor and deploy it.
4. Keep JWT verification enabled.

## 3. Add Supabase Edge Function secrets

In Supabase, open **Edge Functions → Secrets** and add:

- `SUPPORT_EMAIL` = `electrostock.zyx@gmail.com`
- `GOOGLE_APPS_SCRIPT_URL` = the Web app URL ending in `/exec` copied in Step 1
- `GOOGLE_APPS_SCRIPT_SECRET` = the exact same random secret you saved as the Apps Script `SUPPORT_WEBHOOK_SECRET`
- `SUPPORT_TICKET_URL` = `https://electrostock-tan.vercel.app` (optional)

Supabase normally provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Do not put the service-role key or shared secret in `app.js`, `config.js`, or any public repository file.

If you edit the Apps Script after deploying it, create a new deployment version (or edit the existing deployment to use the new version) and keep the same Web app URL when possible.

## 4. Test

After Vercel finishes deploying the latest `app.js`, sign in to ElectroStock and submit a test Support Centre ticket. Confirm that the notification arrives in `electrostock.zyx@gmail.com`. Then reply as the platform support administrator and confirm the customer receives a notification at the email on their Supabase Auth account.

Tickets and replies remain saved in Supabase if an email notification fails. If an email does not arrive, check **Apps Script → Executions** and the Supabase Edge Function logs, and confirm that the shared secret matches exactly.

Email notifications are sent from the Google account that authorizes the Apps Script. Replies typed in ElectroStock are emailed to customers. Replies sent manually from Gmail are not automatically synchronized into the Support Centre.
