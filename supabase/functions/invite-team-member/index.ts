import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://electrostock-tan.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return new Response(JSON.stringify({ error: "Supabase function environment is not configured." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return new Response(JSON.stringify({ error: "Sign in as the store owner first." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const authClient = createClient(url, anonKey, { global: { headers: { Authorization: "Bearer " + token } } });
  const { data: userData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !userData.user) return new Response(JSON.stringify({ error: "Your session is invalid or expired." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: { owner_id?: string; display_name?: string; email?: string; phone?: string | null; role?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "Invalid request body." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

  const ownerId = userData.user.id;
  const displayName = (body.display_name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const role = body.role;
  if (body.owner_id !== ownerId) return new Response(JSON.stringify({ error: "Only the owner can invite staff for their own store." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (!displayName || !email || !["manager", "sales_rep"].includes(role || "")) return new Response(JSON.stringify({ error: "Enter a name, valid email, and supported role." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const admin = createClient(url, serviceKey);
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: displayName, store_owner_id: ownerId, store_role: role },
    redirectTo: "https://electrostock-tan.vercel.app/?auth=invite",
  });
  if (inviteError || !invited.user) return new Response(JSON.stringify({ error: inviteError?.message || "Could not create invitation." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const { error: memberError } = await admin.from("store_members").upsert({
    owner_id: ownerId,
    user_id: invited.user.id,
    display_name: displayName,
    email,
    phone: body.phone || null,
    role,
    active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "owner_id,user_id" });

  if (memberError) return new Response(JSON.stringify({ error: "Invitation was created, but saving the staff role failed: " + memberError.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  return new Response(JSON.stringify({ ok: true, staff_user_id: invited.user.id }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
