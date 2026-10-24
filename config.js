// ElectroStock public browser configuration.
// Supabase publishable/anon keys are intended for frontend use when Row Level Security is enabled.
// Never place a Supabase service_role key or a Paystack secret key in this file.
window.ELECTROSTOCK_CONFIG = {
  supabaseUrl: "https://gldzrhocqlefedoykfdr.supabase.co",
  supabaseAnonKey: "sb_publishable_d07Nq8UWfVJivuhOxRQTgg_Y1l7bNTU",
  // Set these only after creating a ₦1,500/month recurring plan in Paystack.
  // The Paystack public key is safe for the browser; the secret key is not.
  paystackPublicKey: "YOUR_PAYSTACK_PUBLIC_KEY",
  paystackPlanCode: "YOUR_PAYSTACK_PLAN_CODE"
};
