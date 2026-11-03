import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PRO_PLAN_CODE = "PLN_9nqo41emo5bu9z4";

async function hmac(secret:string,body:string){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-512"},false,["sign"]);
  const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map(x=>x.toString(16).padStart(2,"0")).join("");
}
Deno.serve(async(req)=>{
  if(req.method!=="POST") return new Response("Method not allowed",{status:405});
  const secret=Deno.env.get("PAYSTACK_SECRET_KEY"),url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!secret||!url||!service) return new Response("Webhook not configured",{status:500});
  const body=await req.text(),given=req.headers.get("x-paystack-signature")||"",expected=await hmac(secret,body);
  if(given.length!==expected.length) return new Response("Invalid signature",{status:401});
  let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^given.charCodeAt(i);
  if(mismatch) return new Response("Invalid signature",{status:401});
  let event:any;try{event=JSON.parse(body);}catch{return new Response("Invalid JSON",{status:400});}
  // Only activate from a successful, correctly priced Pro charge carrying the signed account metadata.
  if(event.event!=="charge.success") return new Response("OK",{status:200});
  const tx=event.data||{},meta=tx.metadata||{},ownerId=String(meta.owner_id||""),reference=String(tx.reference||"");
  const plan=tx.plan_object?.plan_code||tx.plan;
  if(meta.feature!=="electrostock_pro"||!ownerId||!reference||tx.status!=="success"||
     Number(tx.amount)!==500000||tx.currency!=="NGN"||plan!==PRO_PLAN_CODE) {
    return new Response("Ignored non-Pro or invalid charge",{status:200});
  }
  const admin=createClient(url,service);
  const {error:ledgerError}=await admin.from("pro_subscription_payments").insert({
    reference,owner_id:ownerId,amount:500000,currency:"NGN",source:"webhook"
  });
  if(ledgerError?.code==="23505") return new Response("Already processed",{status:200});
  if(ledgerError) return new Response("Payment ledger failed",{status:500});
  const {data:current}=await admin.from("pro_subscriptions").select("expires_at").eq("owner_id",ownerId).maybeSingle();
  const base=current?.expires_at&&new Date(current.expires_at)>new Date(current.expires_at?Date.now():0)?new Date(current.expires_at):new Date();
  const expiresAt=new Date(base.getTime()+30*24*60*60*1000).toISOString();
  const {error}=await admin.from("pro_subscriptions").upsert({
    owner_id:ownerId,status:"active",expires_at:expiresAt,last_payment_reference:reference,
    paystack_customer_code:tx.customer?.customer_code||null,
    paystack_subscription_code:tx.subscription?.subscription_code||null,
    updated_at:new Date().toISOString()
  },{onConflict:"owner_id"});
  if(error) return new Response("Subscription update failed",{status:500});
  return new Response("OK",{status:200});
});