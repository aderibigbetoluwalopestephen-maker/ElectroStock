import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  try {
    const { owner_id } = await req.json();
    const ownerId = String(owner_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(ownerId)) return reply({ error: "Invalid shop QR code." }, 400);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data, error } = await db.rpc("get_scan_pay_shop", { p_owner_id: ownerId });
    if (error) throw error;
    if (!data) return reply({ error: "This shop has not enabled Scan & Pay." }, 404);
    return reply(data);
  } catch (error) {
    console.error("scan-pay-shop:", error);
    return reply({ error: "Could not load this shop catalogue. Ensure the Scan & Pay SQL migration is installed." }, 500);
  }
});
