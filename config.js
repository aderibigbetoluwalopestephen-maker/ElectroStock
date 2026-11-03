// ElectroStock public browser configuration.
// Supabase publishable/anon keys are intended for frontend use when Row Level Security is enabled.
// Never place a Supabase service_role key or a Paystack secret key in this file.
window.ELECTROSTOCK_CONFIG = {
  supabaseUrl: "https://gldzrhocqlefedoykfdr.supabase.co",
  supabaseAnonKey: "sb_publishable_d07Nq8UWfVJivuhOxRQTgg_Y1l7bNTU",
  // Public Paystack key and public plan code. Never place the secret key here.
  paystackPublicKey: "pk_live_2c0714f7f730d3cc467473e22b4fd97d545d2bdb",
  paystackProPlanCode: "PLN_9nqo41emo5bu9z5"
};
