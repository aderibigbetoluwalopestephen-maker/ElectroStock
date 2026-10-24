import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function hmacSha512(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !url || !serviceKey) return new Response("Webhook not configured", { status: 500 });

  const rawBody = await req.text();
  const supplied = req.headers.get("x-paystack-signature") || "";
  const expected = await hmacSha512(secret, rawBody);
  if (!supplied || supplied.length !== expected.length) return new Response("Invalid signature", { status: 401 });
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  if (diff !== 0) return new Response("Invalid signature", { status: 401 });

  let event: any;
  try { event = JSON.parse(rawBody); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (event?.event === "charge.success" && event?.data?.metadata?.feature === "logo_customization") {
    const tx = event.data;
    const ownerId = String(tx?.metadata?.owner_id || "");
    const reference = String(tx?.reference || "");
    if (ownerId && reference && tx?.status === "success" && Number(tx?.amount) === 150000 && tx?.currency === "NGN") {
      const admin = createClient(url, serviceKey);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await admin.from("logo_subscriptions").upsert({
        owner_id: ownerId, status: "active", expires_at: expiresAt,
        paystack_reference: reference, updated_at: new Date().toISOString(),
      }, { onConflict: "owner_id" });
      if (error) return new Response("Database update failed", { status: 500 });
    }
  }
  return new Response("OK", { status: 200 });
});
