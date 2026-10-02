// Browser-safe Supabase configuration.
// NEVER put a secret/service-role key in this file.
window.UE_CONFIG = {
  SUPABASE_URL: "https://qwlbbfyhjdeekmrxtzjf.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_NaY5yD11Wf2BXSZA67ERkw_fWMKDet_"
};

if (!window.supabase || !window.UE_CONFIG.SUPABASE_URL || !window.UE_CONFIG.SUPABASE_ANON_KEY) {
  console.error("Supabase configuration is missing.");
} else {
  window.sb = window.supabase.createClient(
    window.UE_CONFIG.SUPABASE_URL,
    window.UE_CONFIG.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "ueclubiste-auth"
      }
    }
  );
}
