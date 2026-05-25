import { createClient } from "@supabase/supabase-js";

const viteEnv = typeof import.meta !== "undefined" ? import.meta.env || {} : {};
const runtimeEnv = typeof window !== "undefined" ? window.MATDAILY_ENV || {} : {};

export const supabaseUrl = viteEnv.VITE_SUPABASE_URL || runtimeEnv.VITE_SUPABASE_URL || "";
export const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY || runtimeEnv.VITE_SUPABASE_ANON_KEY || "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
