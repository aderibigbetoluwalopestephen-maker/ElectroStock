# ElectroStock

A responsive personal electronics inventory dashboard built with HTML, CSS, vanilla JavaScript, Supabase Auth, and Supabase Postgres.

## Included
- Dashboard: product count, units, stock value at purchase cost, low/out-of-stock alerts.
- Product catalogue: add, edit, delete, search by name/brand/model/category, category and stock filters.
- Stock movement: purchases, sales/stock out, quantity adjustments, and movement history.
- Configurable currency and company branding (name, phone, email, address, logo and receipt footer).
- Separate Supabase login per customer, with owner-scoped inventory and settings.
- Paid logo customization gate: ₦1,500/month, with Paystack checkout and server-side payment verification when configured.
- Supabase owner authentication and Row Level Security.
- Demo mode for trying the interface before configuring Supabase.

## 1. Run locally
Because the app uses browser JavaScript and a Supabase CDN, use a local static server (recommended) rather than opening the HTML directly:
- VS Code: install Live Server, right-click `index.html`, choose **Open with Live Server**.
- Or run `python -m http.server 5500` in this folder and open `http://localhost:5500`.

Without Supabase configured, use **Open demo workspace**. Demo data is stored only in the current browser's local storage. It is not secure account storage and will not sync between devices.

## 2. Set up Supabase cloud storage
1. Create a project at https://supabase.com.
2. In **SQL Editor**, run all of `supabase/schema.sql`.
3. In **Project Settings → API**, copy the Project URL and the **anon/public** key.
4. Put both values in `config.js`.
5. Run `supabase/sales_migration.sql`, then `supabase/company_settings_migration.sql`, then `supabase/multi_owner_security.sql`, then `supabase/logo_subscription_migration.sql` in SQL Editor, in that order.
6. Reload the site. New customers choose **Create an owner account**, enter their full name, email and password, and verify their email if email confirmation is enabled. After their first sign-in, they complete the business setup screen.
7. If you are selling access to many customers, keep public signups enabled in **Authentication → Settings**. If you want to sell paid access only, add a subscription/payment gate before giving customers access; registration alone should not be treated as proof of payment. Keep the anon key in the frontend; never expose the `service_role` key.
8. In **Authentication → URL Configuration**, configure the Site URL and allowed redirect URLs for your local development address and deployed Vercel URL. The same site origin is used for email confirmation and password recovery.

### Security note
Supabase Row Level Security policies ensure a signed-in user can only access rows where `owner_id` matches their authenticated user ID. The anon/public key is intended for frontend use when RLS is correctly configured. Do not use the service-role key in this project.

## 3. Product images
This version accepts an image URL. To support direct file uploads, create a Supabase Storage bucket (for example `product-images`) and add authenticated-user storage policies before wiring the upload control. Do not make the bucket public unless you intentionally want product images publicly accessible.

## 4. Deploy to Vercel
1. Upload this folder to a GitHub repository.
2. In Vercel, import the repository.
3. Framework preset: **Other**; build command: leave blank; output directory: `.`.
4. Deploy.
5. Add the deployed URL to Supabase Authentication's Site URL / Redirect URLs.
6. Verify login and data access from another browser/device.

## Owner accounts, registration and password recovery

- The login screen supports creating an account with full name, email, password and password confirmation.
- When Supabase email confirmation is enabled, the owner must verify their email before signing in. Configure the allowed redirect URLs in Supabase Authentication settings.
- A first-time signed-in owner is asked to set their business name, contact details, address and currency. These details are stored in `company_settings` under their authenticated user ID; they can change them later from Company Settings.
- Owners can request a password-reset email. When they open the recovery link, the app presents a form to choose a new password.
- The sidebar shows the signed-in owner's name/email. Products, stock movements, sales and company settings must all retain owner-scoped RLS.
- The no-Supabase demo mode is only a local UI preview. It does not create real user accounts and its data is not secure or shared across devices.

For a multi-customer deployment, run `supabase/multi_owner_security.sql` after the other migrations. Test with two separate accounts and verify that neither account can read or modify the other's data before onboarding paying customers.

## Important current-version notes
- The initial quantity field sets starting stock when creating/editing a product. For an auditable purchase/sale history, use the **Stock movement** screen for subsequent stock changes.
- Demo mode is only for UI testing; local browser storage can be cleared and does not sync.
- This starter is not a public online shop and does not process payments.

## Recent updates

- **Printable sales receipts:** In Stock movement, choose **Sale / stock out (-)**, select the product and quantity, optionally enter a customer name, and save. A receipt preview opens with a Print receipt button. The sale reduces stock and records a movement. Receipts are generated for individual product sales.
- **Excel inventory export:** In Products, select **Export Excel** to download an `.xlsx` workbook containing product details, prices, quantities, stock status and inventory cost value. The app falls back to CSV if the spreadsheet library CDN is unavailable.
- **Mobile navigation:** Use the hamburger menu at the top of the mobile sidebar to navigate between Dashboard, Products and Stock movement. Forms, tables and the export action adapt to narrow screens.

The spreadsheet export uses the SheetJS library from its public CDN, so an internet connection is needed for native `.xlsx` generation. Printing receipts uses your browser's print dialog; choose a printer or Save as PDF.

## Sales management setup

The Sales Management section records each sale, deducts stock, stores a unique receipt number, calculates revenue and estimated gross profit, and lets you reprint a saved receipt.

If you use Supabase, run `supabase/sales_migration.sql` in **Supabase Dashboard → SQL Editor** after the original `supabase/schema.sql`. The migration creates the private `sales` table and the `record_sale` database function. It is required for cloud sales history; do not expose a service-role key in the browser. The function runs the stock deduction, sale record, and stock movement together so those database changes succeed or fail as one transaction.

Gross profit is an estimate based on the product's purchase price and selling price stored at the time of sale; it does not account for extra expenses, discounts, taxes, or payment processing fees. The demo workspace keeps sales in that browser's local storage only.


## Company settings and multi-customer branding

The **Company settings** page lets each signed-in customer change their business name, contact details, address, currency, receipt footer and logo without contacting the developer. Branding is applied to the signed-in customer's app sidebar, page title, footer and printed receipts. Settings are stored per authenticated Supabase user; demo mode saves them in that browser only. Products, stock movements, and sales continue to be isolated by their existing owner-based RLS policies.

For Supabase deployments, run `supabase/company_settings_migration.sql` in **SQL Editor** after `schema.sql` and `sales_migration.sql`. This creates the owner-protected `company_settings` table and the `company-logos` Storage bucket with user-folder upload policies. Logo files are public-read so they can appear on printed receipts; uploading, updating, and deleting objects are restricted to the authenticated user's own UUID folder. Accepted logo formats are PNG, JPG, and WEBP (maximum 2 MB).

Each customer can sign up and manage their own settings, but ensure the existing `products`, `sales`, and `stock_movements` RLS policies remain enabled before selling access to multiple customers. The default `ElectroStock` branding remains for accounts that have not saved settings yet.


## ₦1,500/month logo customization subscription

Each customer registers with their own email/password and signs into their private workspace. Their uploaded logo appears in their signed-in app branding and on receipts; another customer cannot see or change their company settings when Row Level Security is correctly configured. The public sign-in screen returns to the ElectroStock default branding after sign-out.

Uploading a custom logo is locked unless that account has an active logo subscription. The subscription price is **₦1,500 per month**. Company name, contact details, currency and receipt footer remain editable without the logo subscription.

To activate real payments:

1. In Paystack, create a **recurring monthly plan priced at ₦1,500 NGN**. Copy its plan code.
2. Set `paystackPublicKey` and `paystackPlanCode` in `config.js`. Only the Paystack public key belongs in frontend config; never place the Paystack secret key there.
3. Run `supabase/logo_subscription_migration.sql` after the other migrations.
4. Deploy the Supabase Edge Functions `verify-logo-subscription` and `paystack-logo-webhook` from `supabase/functions/`.
5. Configure `PAYSTACK_SECRET_KEY` as an Edge Function secret. Do not expose it in `config.js` or commit it to Git.
6. In the Paystack dashboard, set the webhook URL to your deployed `paystack-logo-webhook` Edge Function URL.
7. Test with Paystack test keys first. Confirm successful payment activates the logo upload for only that account, and that a second account remains locked until it pays.

The checkout is deliberately fail-closed: if Supabase, the subscription migration, Paystack plan configuration, or payment verification is missing, it will not unlock logo uploads. The subscription verification currently sets a 30-day active period following verified payment; recurring renewals should be tested with Paystack's webhook before going live. Do not treat a browser success callback alone as proof of payment.
