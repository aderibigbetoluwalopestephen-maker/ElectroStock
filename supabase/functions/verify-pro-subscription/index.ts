import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PRO_PLAN_CODE = "PLN_9nqo41emo5bu9z5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status=200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers:cors});
  if (req.method !== "POST") return reply({error:"Method not allowed."},405);
  const url=Deno.env.get("SUPABASE_URL"), anon=Deno.env.get("SUPABASE_ANON_KEY");
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), secret=Deno.env.get("PAYSTACK_SECRET_KEY");
  if(!url||!anon||!service||!secret) return reply({error:"Payment verification is not configured on the server."},500);
  const auth=req.headers.get("Authorization");
  if(!auth) return reply({error:"Sign in required."},401);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const {data:{user},error:userError}=await userClient.auth.getUser();
  if(userError||!user) return reply({error:"Your session is invalid. Sign in again."},401);
  let reference="";
  try{reference=String((await req.json()).reference||"").trim();}catch{return reply({error:"Invalid request."},400);}
  if(!reference||reference.length>120) return reply({error:"A valid payment reference is required."},400);

  const response=await fetch("https://api.paystack.co/transaction/verify/"+encodeURIComponent(reference),{
    headers:{Authorization:"Bearer "+secret}
  });
  const payload=await response.json().catch(()=>null), tx=payload?.data;
  if(!response.ok||!payload?.status||tx?.status!=="success") return reply({error:"Paystack could not confirm a successful payment."},402);
  if(Number(tx.amount)!==500000||tx.currency!=="NGN") return reply({error:"The verified payment amount or currency does not match the Pro plan."},402);
  if(tx.metadata?.feature!=="electrostock_pro"||tx.metadata?.owner_id!==user.id) return reply({error:"This payment reference does not belong to your ElectroStock account."},403);
  const plan=tx.plan_object?.plan_code||tx.plan;
  if(plan!==PRO_PLAN_CODE) return reply({error:"The payment is not linked to the ElectroStock Pro recurring plan."},402);

  const admin=createClient(url,service);
  const {data:existing}=await admin.from("pro_subscription_payments").select("reference").eq("reference",reference).maybeSingle();
  if(existing){
    const {data:sub,error}=await admin.from("pro_subscriptions").select("expires_at,status").eq("owner_id",user.id).maybeSingle();
    if(error||!sub) return reply({error:"Payment was recorded but subscription status could not be loaded."},500);
    return reply({active:sub.status==="active",expires_at:sub.expires_at});
  }
  const {error:ledgerError}=await admin.from("pro_subscription_payments").insert({
    reference,owner_id:user.id,amount:500000,currency:"NGN",source:"verification"
  });
  if(ledgerError) return reply({error:"Payment verification is being reconciled. Do not pay again; contact support with your reference."},500);

  const {data:current}=await admin.from("pro_subscriptions").select("expires_at").eq("owner_id",user.id).maybeSingle();
  const base=current?.expires_at&&new Date(current.expires_at)>new Date()?new Date(current.expires_at):new Date();
  const expiresAt=new Date(base.getTime()+30*24*60*60*1000).toISOString();
  const {error:saveError}=await admin.from("pro_subscriptions").upsert({
    owner_id:user.id,status:"active",expires_at:expiresAt,last_payment_reference:reference,
    paystack_customer_code:tx.customer?.customer_code||null,
    paystack_subscription_code:tx.subscription?.subscription_code||null,
    updated_at:new Date().toISOString()
  },{onConflict:"owner_id"});
  if(saveError) return reply({error:"Payment verified but Pro activation failed. Contact support with your payment reference."},500);
  return reply({active:true,expires_at:expiresAt});
});