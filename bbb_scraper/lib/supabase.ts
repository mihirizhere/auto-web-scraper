import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side client with service role key for admin operations
export const supabaseAdmin = createClient(
  supabaseUrl,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export type Database = {
  public: {
    Tables: {
      medical_billing_companies: {
        Row: {
          id: string;
          name: string;
          phone: string;
          principal_contact: string;
          url: string;
          address: string;
          accreditation: string;
          scraped_from_url: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          phone?: string;
          principal_contact?: string;
          url: string;
          address?: string;
          accreditation?: string;
          scraped_from_url: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          phone?: string;
          principal_contact?: string;
          url?: string;
          address?: string;
          accreditation?: string;
          scraped_from_url?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
};