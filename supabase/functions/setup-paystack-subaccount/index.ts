import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return reply({ error: "Sign in to connect a payout account." }, 401);
    if (!secret) return reply({ error: "Paystack is not configured on the server." }, 503);
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return reply({ error: "Your session is invalid. Sign in again." }, 401);
    const body = await req.json();
    const businessName = String(body.business_name || "").trim().slice(0, 100);
    const bankCode = String(body.bank_code || "").trim().slice(0, 20);
    const accountNumber = String(body.account_number || "").replace(/\D/g, "");
    if (!businessName || !bankCode || !/^\d{10}$/.test(accountNumber)) return reply({ error: "Enter the business name, bank code and valid 10-digit Nigerian account number." }, 400);
    const response = await fetch("https://api.paystack.co/subaccount", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ business_name: businessName, settlement_bank: bankCode, account_number: accountNumber, percentage_charge: 0 }),
    });
    const result = await response.json();
    if (!response.ok || !result.status || !result.data?.subaccount_code) return reply({ error: result.message || "Paystack could not set up this account. Check the bank code and account details." }, 400);
    const { error: saveError } = await userClient.from("company_settings").upsert({
      owner_id: user.id,
      company_name: businessName,
      paystack_subaccount_code: result.data.subaccount_code,
      payment_account_name: String(result.data.account_name || businessName).slice(0, 150),
      payment_bank_code: bankCode,
      payment_account_last4: accountNumber.slice(-4),
      scan_pay_enabled: true,
    }, { onConflict: "owner_id" });
    if (saveError) return reply({ error: "Paystack account was created but settings could not be saved. Run supabase/scan_pay_migration.sql and try again." }, 500);
    return reply({ success: true, account_name: String(result.data.account_name || businessName), account_last4: accountNumber.slice(-4), message: "Payout account connected." });
  } catch (error) {
    console.error("setup-paystack-subaccount:", error);
    return reply({ error: "Unexpected error while connecting the payout account." }, 500);
  }
});
