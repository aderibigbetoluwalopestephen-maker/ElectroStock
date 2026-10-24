import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  try {
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    const dbKey = Deno.env.get("SCAN_PAY_DB_KEY");
    if (!secret || !dbKey) return reply({ error: "Payment verification is not configured on the server." }, 503);
    const reference = String((await req.json()).reference || "").trim();
    if (!/^ESQR-[a-f0-9]{32}$/i.test(reference)) return reply({ error: "Invalid payment reference." }, 400);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, dbKey);
    const { data: payment, error } = await db.from("scan_payments")
      .select("reference,amount_kobo,currency,status")
      .eq("reference", reference).maybeSingle();
    if (error) throw error;
    if (!payment) return reply({ error: "Payment reference not found." }, 404);
    if (payment.status === "paid") return reply({ success: true, status: "paid", reference, message: "Payment already verified." });
    const response = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference), {
      headers: { Authorization: "Bearer " + secret },
    });
    const verified = await response.json();
    if (!response.ok || !verified.status || verified.data?.status !== "success") {
      return reply({ success: false, status: verified.data?.status || "pending", message: "Paystack has not confirmed a successful payment yet." }, 402);
    }
    if (String(verified.data.reference) !== reference || Number(verified.data.amount) !== Number(payment.amount_kobo) || String(verified.data.currency) !== String(payment.currency)) {
      return reply({ error: "Payment details do not match this order. Contact support." }, 409);
    }
    const { data: result, error: finalizeError } = await db.rpc("complete_scan_pay_sale", {
      p_reference: reference, p_transaction_id: String(verified.data.id),
    });
    if (finalizeError) {
      console.error("Verified payment could not be finalized:", reference, finalizeError);
      return reply({ success: false, paid: true, reference, error: "Paystack confirms payment, but the sale needs owner attention. Save this reference and contact the shop before paying again." }, 409);
    }
    return reply({ success: true, status: "paid", reference, receipt: result });
  } catch (error) {
    console.error("scan-pay-verify:", error);
    return reply({ error: "Could not verify this payment right now." }, 500);
  }
});
