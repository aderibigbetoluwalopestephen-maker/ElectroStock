import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey || !paystackSecret) {
    return json({ error: "Server payment verification is not configured." }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Sign in required." }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: "Invalid session." }, 401);

  let reference = "";
  try { reference = String((await req.json()).reference || "").trim(); } catch { return json({ error: "Invalid request body." }, 400); }
  if (!reference || reference.length > 120) return json({ error: "A valid payment reference is required." }, 400);

  const verifyResponse = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference), {
    headers: { Authorization: "Bearer " + paystackSecret },
  });
  const verification = await verifyResponse.json();
  const tx = verification?.data;
  if (!verifyResponse.ok || !verification?.status || tx?.status !== "success") return json({ error: "Payment could not be verified." }, 402);
  if (tx?.metadata?.feature !== "logo_customization" || tx?.metadata?.owner_id !== user.id) return json({ error: "Payment does not belong to this account." }, 403);
  if (Number(tx?.amount) !== 150000 || tx?.currency !== "NGN") return json({ error: "Payment amount or currency is incorrect." }, 402);

  const admin = createClient(supabaseUrl, serviceKey);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await admin.from("logo_subscriptions").upsert({
    owner_id: user.id, status: "active", expires_at: expiresAt,
    paystack_reference: reference, updated_at: new Date().toISOString(),
  }, { onConflict: "owner_id" });
  if (error) return json({ error: "Payment verified but subscription activation failed." }, 500);
  return json({ active: true, expires_at: expiresAt });
});
