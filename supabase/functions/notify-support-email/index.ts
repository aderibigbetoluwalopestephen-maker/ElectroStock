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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const brevoKey = Deno.env.get("BREVO_API_KEY");
    const supportEmail = Deno.env.get("SUPPORT_EMAIL");
    const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL");
    const senderName = Deno.env.get("BREVO_SENDER_NAME") || "ElectroStock Support";
    if (!supabaseUrl || !anonKey || !serviceKey || !brevoKey || !supportEmail || !senderEmail) {
      return json({ error: "Support email is not configured. Add BREVO_API_KEY, SUPPORT_EMAIL and BREVO_SENDER_EMAIL to Supabase Edge Function secrets." }, 503);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Sign in is required." }, 401);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Your session could not be verified." }, 401);

    const payload = await req.json();
    const ticketId = String(payload?.ticket_id || "");
    const messageId = String(payload?.message_id || "");
    if (!ticketId || !messageId) return json({ error: "ticket_id and message_id are required." }, 400);

    const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const [{ data: ticket, error: ticketError }, { data: message, error: messageError }, { data: admin }] = await Promise.all([
      adminClient.from("support_tickets").select("id,store_owner_id,created_by,subject,category,priority,status").eq("id", ticketId).maybeSingle(),
      adminClient.from("support_ticket_messages").select("id,ticket_id,sender_id,message,created_at").eq("id", messageId).eq("ticket_id", ticketId).maybeSingle(),
      adminClient.from("platform_support_admins").select("user_id").eq("user_id", userData.user.id).maybeSingle(),
    ]);
    if (ticketError || !ticket) return json({ error: "Support ticket was not found." }, 404);
    if (messageError || !message || message.sender_id !== userData.user.id) return json({ error: "The message could not be verified." }, 403);

    const isAdmin = !!admin;
    const isParticipant = userData.user.id === ticket.store_owner_id || userData.user.id === ticket.created_by;
    if (!isAdmin && !isParticipant) {
      const { data: membership } = await adminClient.from("store_members").select("user_id").eq("user_id", userData.user.id).eq("owner_id", ticket.store_owner_id).maybeSingle();
      if (!membership) return json({ error: "You are not allowed to notify this support ticket." }, 403);
    }

    let recipient = supportEmail;
    let subject = "[ElectroStock Support] New customer message: " + ticket.subject;
    let greeting = "A customer has sent a message to ElectroStock support.";
    if (isAdmin) {
      const { data: customerData, error: customerError } = await adminClient.auth.admin.getUserById(ticket.created_by);
      const customerEmail = customerData?.user?.email;
      if (customerError || !customerEmail) return json({ error: "The ticket creator has no available email address." }, 422);
      recipient = customerEmail;
      subject = "[ElectroStock Support] Reply to your request: " + ticket.subject;
      greeting = "ElectroStock support has replied to your request.";
    }

    const ticketUrl = Deno.env.get("SUPPORT_TICKET_URL") || "https://electrostock-tan.vercel.app";
    const htmlContent = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#202938;max-width:640px;margin:auto"><h2>ElectroStock Support</h2><p>${escapeHtml(greeting)}</p><p><strong>Subject:</strong> ${escapeHtml(ticket.subject)}</p><p><strong>Category:</strong> ${escapeHtml(ticket.category || "Other")}<br><strong>Status:</strong> ${escapeHtml(ticket.status || "open")}<br><strong>Request reference:</strong> ${escapeHtml(ticket.id.slice(0, 8).toUpperCase())}</p><div style="background:#f5f7fa;padding:16px;border-radius:8px;white-space:pre-wrap">${escapeHtml(message.message)}</div><p><a href="${escapeHtml(ticketUrl)}">Open ElectroStock</a> to view the full conversation.</p><p style="font-size:12px;color:#687386">Please do not reply to this automated notification unless your verified sender address is configured to receive replies.</p></div>`;

    const emailResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "accept": "application/json", "api-key": brevoKey, "content-type": "application/json" },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: recipient }],
        subject,
        htmlContent,
        textContent: greeting + "\nSubject: " + ticket.subject + "\nRequest: " + ticket.id.slice(0, 8).toUpperCase() + "\n\n" + message.message + "\n\nOpen ElectroStock: " + ticketUrl,
      }),
    });
    if (!emailResponse.ok) {
      const detail = await emailResponse.text();
      console.error("Brevo support notification failed:", emailResponse.status, detail);
      return json({ error: "The ticket was saved, but the email notification failed. Check the Brevo sender and Edge Function secrets." }, 502);
    }
    return json({ success: true });
  } catch (error) {
    console.error("Support email notification error:", error);
    return json({ error: "Unexpected error while sending the support email." }, 500);
  }
});
