import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  try {
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!secret) return reply({ error: "Paystack is not configured on the server." }, 503);
    const body = await req.json();
    const ownerId = String(body.owner_id || "");
    const email = String(body.customer_email || "").trim().toLowerCase();
    if (!/^[0-9a-f-]{36}$/i.test(ownerId)) return reply({ error: "Invalid shop QR code." }, 400);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: order, error } = await db.rpc("create_scan_pay_order", {
      p_owner_id: ownerId,
      p_customer_email: email,
      p_customer_name: String(body.customer_name || "").slice(0, 120),
      p_requested_items: Array.isArray(body.items) ? body.items : [],
    });
    if (error) return reply({ error: error.message }, 400);
    const origin = req.headers.get("origin") || "https://example.com";
    const callback = new URL("/pay.html", origin);
    callback.searchParams.set("shop", ownerId);
    callback.searchParams.set("reference", order.reference);
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email, amount: order.amount_kobo, currency: "NGN", reference: order.reference,
        subaccount: order.subaccount_code, transaction_charge: 0, bearer: "subaccount",
        callback_url: callback.toString(),
        metadata: { custom_fields: [{ display_name: "Shop", variable_name: "shop", value: String(order.shop_name || "ElectroStock") }] },
      }),
    });
    const paystack = await response.json();
    if (!response.ok || !paystack.status || !paystack.data?.authorization_url) return reply({ error: paystack.message || "Paystack could not start checkout." }, 502);
    return reply({ authorization_url: paystack.data.authorization_url, reference: order.reference });
  } catch (error) {
    console.error("scan-pay-create:", error);
    return reply({ error: error instanceof Error ? error.message : "Could not start checkout." }, 500);
  }
});
