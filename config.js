// ElectroStock public browser configuration.
// Supabase publishable/anon keys are intended for frontend use when Row Level Security is enabled.
// Never place a Supabase service_role key or a Paystack secret key in this file.
window.ELECTROSTOCK_CONFIG = {
  supabaseUrl: "https://gldzrhocqlefedoykfdr.supabase.co",
  supabaseAnonKey: "sb_publishable_d07Nq8UWfVJivuhOxRQTgg_Y1l7bNTU",
  // Set these only after creating a ₦1,500/month recurring plan in Paystack.
  // The Paystack public key is safe for the browser; the secret key is not.
  paystackPublicKey: "pk_live_2c0714f7f730d3cc467473e22b4fd97d545d2bdb",
  paystackPlanCode: "PLN_cwk4lx7n32j31yh"
};
