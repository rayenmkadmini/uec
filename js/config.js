// Browser-safe Supabase configuration.
// NEVER put a secret/service-role key in this file.
window.UE_CONFIG = {
  SUPABASE_URL: "https://qwlbbfyhjdeekmrxtzjf.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_NaY5yD11Wf2BXSZA67ERkw_fWMKDet_"
};

// Snapshot of the URL as Supabase Auth redirected to it. The client below
// (detectSessionInUrl) consumes the fragment, including error details of an
// expired or reused activation link, before page scripts run.
window.UE_AUTH_REDIRECT = { hash: location.hash, search: location.search };

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
