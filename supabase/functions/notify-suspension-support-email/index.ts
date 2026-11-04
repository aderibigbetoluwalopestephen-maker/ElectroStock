import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[ch] || ch));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const scriptUrl = Deno.env.get("GOOGLE_APPS_SCRIPT_URL");
    const scriptSecret = Deno.env.get("GOOGLE_APPS_SCRIPT_SECRET");
    const supportEmail = Deno.env.get("SUPPORT_EMAIL") || "electrostock.zyx@gmail.com";
    if (!url || !anon || !service || !scriptUrl || !scriptSecret) {
      return json({ error: "Email delivery is not configured. Set GOOGLE_APPS_SCRIPT_URL and GOOGLE_APPS_SCRIPT_SECRET in Supabase Edge Function secrets." }, 503);
    }
    const payload = await req.json();
    const requestId = String(payload?.request_id || "");
    const mode = String(payload?.mode || "");
    if (!requestId || !["new_request", "admin_reply"].includes(mode)) return json({ error: "Invalid support email request." }, 400);

    const adminClient = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: request, error: requestError } = await adminClient
      .from("suspension_support_requests")
      .select("id,name,email,subject,message,status,admin_reply,notification_sent_at")
      .eq("id", requestId).maybeSingle();
    if (requestError || !request) return json({ error: "Support request was not found." }, 404);

    let to = supportEmail;
    let subject = "[ElectroStock] New suspended-account support request: " + request.subject;
    let bodyText = "A suspended customer has submitted a support request.\n\nName: " + request.name +
      "\nEmail: " + request.email + "\nAccount request: " + request.id +
      "\nSubject: " + request.subject + "\n\n" + request.message;
    if (mode === "new_request") {
      if (request.notification_sent_at) return json({ success: true, already_notified: true });
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "Administrator sign-in is required." }, 401);
      const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData.user) return json({ error: "Administrator session could not be verified." }, 401);
      const { data: admin } = await adminClient.from("platform_admins").select("user_id").eq("user_id", userData.user.id).maybeSingle();
      if (!admin) return json({ error: "Not authorised." }, 403);
      const reply = String(payload?.reply || "").trim();
      if (!reply || reply.length > 5000 || reply !== request.admin_reply) return json({ error: "The saved administrator reply could not be verified." }, 400);
      to = request.email;
      subject = "[ElectroStock] Response to your support request: " + request.subject;
      bodyText = "Hello " + request.name + ",\n\n" + reply + "\n\nElectroStock Support";
    }

    const htmlBody = '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#202938;max-width:640px;margin:auto"><h2>ElectroStock Support</h2><p style="white-space:pre-wrap">' +
      escapeHtml(bodyText) + '</p><p>Support email: ' + escapeHtml(supportEmail) + '</p></div>';
    const response = await fetch(scriptUrl, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: scriptSecret, to, replyTo: supportEmail, subject, htmlBody, plainBody: bodyText }),
    });
    const responseText = await response.text();
    let result: Record<string, unknown> = {};
    try { result = JSON.parse(responseText); } catch { /* Ignore non-JSON Apps Script responses. */ }
    if (!response.ok || result.success !== true) {
      console.error("Suspended-account support email failed:", response.status, responseText.slice(0, 800));
      return json({ error: "The request was saved, but Gmail could not send the notification." }, 502);
    }
    if (mode === "new_request") {
      await adminClient.from("suspension_support_requests").update({ notification_sent_at: new Date().toISOString() }).eq("id", requestId);
    }
    return json({ success: true });
  } catch (error) {
    console.error("Suspended-account support email error:", error);
    return json({ error: "Unexpected error while sending the support email." }, 500);
  }
});
