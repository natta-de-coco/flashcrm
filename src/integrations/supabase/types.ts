export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      advisor_reports: {
        Row: {
          content: Json
          created_at: string
          created_by: string | null
          id: string
          kind: string
          question: string | null
          tenant_id: string
        }
        Insert: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          question?: string | null
          tenant_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          question?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "advisor_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advisor_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advisor_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      ai_provider_keys: {
        Row: {
          active: boolean
          api_key: string
          created_at: string
          created_by: string | null
          id: string
          label: string
          provider: string
          tenant_id: string
        }
        Insert: {
          active?: boolean
          api_key: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          provider: string
          tenant_id: string
        }
        Update: {
          active?: boolean
          api_key?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          provider?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_provider_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_provider_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_provider_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      ai_usage_log: {
        Row: {
          created_at: string
          duration_ms: number | null
          feature: string
          id: string
          ok: boolean
          provider: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          feature: string
          id?: string
          ok?: boolean
          provider?: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          feature?: string
          id?: string
          ok?: boolean
          provider?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          last_used_at: string | null
          name: string
          prefix: string
          revoked_at: string | null
          scopes: string[]
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          last_used_at?: string | null
          name: string
          prefix: string
          revoked_at?: string | null
          scopes?: string[]
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          last_used_at?: string | null
          name?: string
          prefix?: string
          revoked_at?: string | null
          scopes?: string[]
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_label: string | null
          created_at: string
          details: Json
          entity_id: string | null
          entity_type: string | null
          id: string
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_label?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_label?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      auth_email_attempts: {
        Row: {
          accepted_at: string | null
          action_type: string
          attempt_number: number
          created_at: string
          id: string
          provider_error: string | null
          recipient_email: string
          requested_at: string
          status: string
          tenant_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          action_type: string
          attempt_number: number
          created_at?: string
          id?: string
          provider_error?: string | null
          recipient_email: string
          requested_at?: string
          status: string
          tenant_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          action_type?: string
          attempt_number?: number
          created_at?: string
          id?: string
          provider_error?: string | null
          recipient_email?: string
          requested_at?: string
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auth_email_attempts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auth_email_attempts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auth_email_attempts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_name: string | null
          account_number: string | null
          bank_name: string
          branch: string | null
          created_at: string
          currency: string | null
          iban: string | null
          id: string
          is_default: boolean
          label: string
          swift: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          bank_name: string
          branch?: string | null
          created_at?: string
          currency?: string | null
          iban?: string | null
          id?: string
          is_default?: boolean
          label: string
          swift?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string
          branch?: string | null
          created_at?: string
          currency?: string | null
          iban?: string | null
          id?: string
          is_default?: boolean
          label?: string
          swift?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      billing_settings: {
        Row: {
          address: string | null
          approval_mode: string
          country: string | null
          created_at: string
          custom_fields: Json
          default_currency: string
          default_notes: string | null
          default_payment_terms: string | null
          default_tax_rate: number
          default_terms: string | null
          discount_approval_threshold: number
          email: string | null
          legal_name: string | null
          logo_url: string | null
          numbering: Json
          online_payment_url: string | null
          pdf_security: Json
          phone: string | null
          registration_number: string | null
          reminder_rules: Json
          show_flash_branding: boolean
          show_qr_verification: boolean
          signatory_name: string | null
          signatory_position: string | null
          signature_url: string | null
          stamp_url: string | null
          tax_enabled: boolean
          tax_inclusive: boolean
          tax_label: string
          tenant_id: string
          timezone: string
          trade_name: string | null
          updated_at: string
          vat_number: string | null
          watermark_enabled: boolean
          watermark_opacity: number
          watermark_scale: number
          website: string | null
        }
        Insert: {
          address?: string | null
          approval_mode?: string
          country?: string | null
          created_at?: string
          custom_fields?: Json
          default_currency?: string
          default_notes?: string | null
          default_payment_terms?: string | null
          default_tax_rate?: number
          default_terms?: string | null
          discount_approval_threshold?: number
          email?: string | null
          legal_name?: string | null
          logo_url?: string | null
          numbering?: Json
          online_payment_url?: string | null
          pdf_security?: Json
          phone?: string | null
          registration_number?: string | null
          reminder_rules?: Json
          show_flash_branding?: boolean
          show_qr_verification?: boolean
          signatory_name?: string | null
          signatory_position?: string | null
          signature_url?: string | null
          stamp_url?: string | null
          tax_enabled?: boolean
          tax_inclusive?: boolean
          tax_label?: string
          tenant_id: string
          timezone?: string
          trade_name?: string | null
          updated_at?: string
          vat_number?: string | null
          watermark_enabled?: boolean
          watermark_opacity?: number
          watermark_scale?: number
          website?: string | null
        }
        Update: {
          address?: string | null
          approval_mode?: string
          country?: string | null
          created_at?: string
          custom_fields?: Json
          default_currency?: string
          default_notes?: string | null
          default_payment_terms?: string | null
          default_tax_rate?: number
          default_terms?: string | null
          discount_approval_threshold?: number
          email?: string | null
          legal_name?: string | null
          logo_url?: string | null
          numbering?: Json
          online_payment_url?: string | null
          pdf_security?: Json
          phone?: string | null
          registration_number?: string | null
          reminder_rules?: Json
          show_flash_branding?: boolean
          show_qr_verification?: boolean
          signatory_name?: string | null
          signatory_position?: string | null
          signature_url?: string | null
          stamp_url?: string | null
          tax_enabled?: boolean
          tax_inclusive?: boolean
          tax_label?: string
          tenant_id?: string
          timezone?: string
          trade_name?: string | null
          updated_at?: string
          vat_number?: string | null
          watermark_enabled?: boolean
          watermark_opacity?: number
          watermark_scale?: number
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      bot_settings: {
        Row: {
          bot_name: string
          business_hours_only: boolean
          enabled: boolean
          greeting: string
          handoff_keywords: string[]
          id: boolean
          instructions: string
          model: string
          updated_at: string
        }
        Insert: {
          bot_name?: string
          business_hours_only?: boolean
          enabled?: boolean
          greeting?: string
          handoff_keywords?: string[]
          id?: boolean
          instructions?: string
          model?: string
          updated_at?: string
        }
        Update: {
          bot_name?: string
          business_hours_only?: boolean
          enabled?: boolean
          greeting?: string
          handoff_keywords?: string[]
          id?: boolean
          instructions?: string
          model?: string
          updated_at?: string
        }
        Relationships: []
      }
      business_profiles: {
        Row: {
          avoid_products: string | null
          brand_personality: string | null
          brands: string | null
          business_name: string | null
          business_stage: string | null
          city: string | null
          competitors: string | null
          compliance_rules: string | null
          contact_details: string | null
          country: string | null
          created_at: string
          currency: string | null
          description: string | null
          forbidden_words: string | null
          id: string
          industry: string | null
          keywords: string | null
          learned_facts: string | null
          locations: string | null
          main_goal: string | null
          marketing_goals: string | null
          monthly_revenue_target: number | null
          niche: string | null
          preferred_cta: string | null
          pricing_approach: string | null
          priority_products: string | null
          products_summary: string | null
          qa: Json
          seasonal_campaigns: string | null
          services_summary: string | null
          target_cities: string | null
          target_countries: string | null
          target_customers: string | null
          tenant_id: string
          tone: string | null
          updated_at: string
          usp: string | null
          website_url: string | null
        }
        Insert: {
          avoid_products?: string | null
          brand_personality?: string | null
          brands?: string | null
          business_name?: string | null
          business_stage?: string | null
          city?: string | null
          competitors?: string | null
          compliance_rules?: string | null
          contact_details?: string | null
          country?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          forbidden_words?: string | null
          id?: string
          industry?: string | null
          keywords?: string | null
          learned_facts?: string | null
          locations?: string | null
          main_goal?: string | null
          marketing_goals?: string | null
          monthly_revenue_target?: number | null
          niche?: string | null
          preferred_cta?: string | null
          pricing_approach?: string | null
          priority_products?: string | null
          products_summary?: string | null
          qa?: Json
          seasonal_campaigns?: string | null
          services_summary?: string | null
          target_cities?: string | null
          target_countries?: string | null
          target_customers?: string | null
          tenant_id: string
          tone?: string | null
          updated_at?: string
          usp?: string | null
          website_url?: string | null
        }
        Update: {
          avoid_products?: string | null
          brand_personality?: string | null
          brands?: string | null
          business_name?: string | null
          business_stage?: string | null
          city?: string | null
          competitors?: string | null
          compliance_rules?: string | null
          contact_details?: string | null
          country?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          forbidden_words?: string | null
          id?: string
          industry?: string | null
          keywords?: string | null
          learned_facts?: string | null
          locations?: string | null
          main_goal?: string | null
          marketing_goals?: string | null
          monthly_revenue_target?: number | null
          niche?: string | null
          preferred_cta?: string | null
          pricing_approach?: string | null
          priority_products?: string | null
          products_summary?: string | null
          qa?: Json
          seasonal_campaigns?: string | null
          services_summary?: string | null
          target_cities?: string | null
          target_countries?: string | null
          target_customers?: string | null
          tenant_id?: string
          tone?: string | null
          updated_at?: string
          usp?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      campaign_plans: {
        Row: {
          budget_note: string | null
          created_at: string
          created_by: string | null
          goal: string
          id: string
          plan: Json
          product: string | null
          tenant_id: string
        }
        Insert: {
          budget_note?: string | null
          created_at?: string
          created_by?: string | null
          goal: string
          id?: string
          plan: Json
          product?: string | null
          tenant_id: string
        }
        Update: {
          budget_note?: string | null
          created_at?: string
          created_by?: string | null
          goal?: string
          id?: string
          plan?: Json
          product?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      campaigns: {
        Row: {
          audience_tag: string | null
          body: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          recipients_count: number
          scheduled_at: string | null
          sent_at: string | null
          status: string
          subject: string
          tenant_id: string
        }
        Insert: {
          audience_tag?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          recipients_count?: number
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          tenant_id?: string
        }
        Update: {
          audience_tag?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          recipients_count?: number
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      connection_retry_log: {
        Row: {
          account_id: string | null
          created_at: string
          details: Json
          id: string
          outcome: string
          platform: string
          reason: string | null
          tenant_id: string
          trigger: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          outcome: string
          platform: string
          reason?: string | null
          tenant_id: string
          trigger?: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          outcome?: string
          platform?: string
          reason?: string | null
          tenant_id?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "connection_retry_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connection_retry_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connection_retry_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connection_retry_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      contact_branches: {
        Row: {
          address: string | null
          city: string | null
          contact_id: string
          country: string | null
          created_at: string
          id: string
          is_primary: boolean
          name: string
          notes: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          contact_id: string
          country?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          name: string
          notes?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          contact_id?: string
          country?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          name?: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_branches_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_branches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_branches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_branches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      contact_identities: {
        Row: {
          branch_id: string | null
          contact_id: string
          created_at: string
          id: string
          is_primary: boolean
          kind: string
          label: string | null
          normalized: string | null
          tenant_id: string
          value: string
        }
        Insert: {
          branch_id?: string | null
          contact_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          kind: string
          label?: string | null
          normalized?: string | null
          tenant_id: string
          value: string
        }
        Update: {
          branch_id?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          kind?: string
          label?: string | null
          normalized?: string | null
          tenant_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_identities_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "contact_branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_identities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_identities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_identities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_identities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      contacts: {
        Row: {
          company: string | null
          consent_at: string | null
          consent_given: boolean
          created_at: string
          email: string | null
          id: string
          last_message_at: string | null
          name: string
          notes: string | null
          owner_id: string | null
          phone: string | null
          stage: Database["public"]["Enums"]["lead_stage"]
          tags: string[]
          tenant_id: string
          updated_at: string
          value: number
        }
        Insert: {
          company?: string | null
          consent_at?: string | null
          consent_given?: boolean
          created_at?: string
          email?: string | null
          id?: string
          last_message_at?: string | null
          name?: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          stage?: Database["public"]["Enums"]["lead_stage"]
          tags?: string[]
          tenant_id?: string
          updated_at?: string
          value?: number
        }
        Update: {
          company?: string | null
          consent_at?: string | null
          consent_given?: boolean
          created_at?: string
          email?: string | null
          id?: string
          last_message_at?: string | null
          name?: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          stage?: Database["public"]["Enums"]["lead_stage"]
          tags?: string[]
          tenant_id?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "contacts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      content_posts: {
        Row: {
          author_id: string | null
          body: string | null
          created_at: string
          id: string
          media_urls: string[]
          platforms: string[]
          scheduled_at: string | null
          seo_metadata: Json
          status: string
          tenant_id: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          media_urls?: string[]
          platforms?: string[]
          scheduled_at?: string | null
          seo_metadata?: Json
          status?: string
          tenant_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          media_urls?: string[]
          platforms?: string[]
          scheduled_at?: string | null
          seo_metadata?: Json
          status?: string
          tenant_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_posts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_posts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_posts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      conversations: {
        Row: {
          assigned_to: string | null
          bot_enabled: boolean
          channel: Database["public"]["Enums"]["conv_channel"]
          contact_id: string
          created_at: string
          id: string
          last_message_at: string
          last_message_preview: string | null
          status: Database["public"]["Enums"]["conv_status"]
          tags: string[]
          tenant_id: string
          unread_count: number
          updated_at: string
          wa_number_id: string | null
          web_session_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          bot_enabled?: boolean
          channel?: Database["public"]["Enums"]["conv_channel"]
          contact_id: string
          created_at?: string
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          status?: Database["public"]["Enums"]["conv_status"]
          tags?: string[]
          tenant_id?: string
          unread_count?: number
          updated_at?: string
          wa_number_id?: string | null
          web_session_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          bot_enabled?: boolean
          channel?: Database["public"]["Enums"]["conv_channel"]
          contact_id?: string
          created_at?: string
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          status?: Database["public"]["Enums"]["conv_status"]
          tags?: string[]
          tenant_id?: string
          unread_count?: number
          updated_at?: string
          wa_number_id?: string | null
          web_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "conversations_wa_number_id_fkey"
            columns: ["wa_number_id"]
            isOneToOne: false
            referencedRelation: "wa_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_briefs: {
        Row: {
          actions: Json
          brief_date: string
          created_at: string
          headline: string
          id: string
          summary: string
          tenant_id: string
        }
        Insert: {
          actions?: Json
          brief_date?: string
          created_at?: string
          headline: string
          id?: string
          summary: string
          tenant_id: string
        }
        Update: {
          actions?: Json
          brief_date?: string
          created_at?: string
          headline?: string
          id?: string
          summary?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_briefs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_briefs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_briefs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      deletion_requests: {
        Row: {
          created_at: string
          details: Json
          id: string
          processed_at: string | null
          requested_by: string | null
          scope: string
          status: string
          target: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          processed_at?: string | null
          requested_by?: string | null
          scope?: string
          status?: string
          target?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          processed_at?: string | null
          requested_by?: string | null
          scope?: string
          status?: string
          target?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deletion_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deletion_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deletion_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      document_activity: {
        Row: {
          actor_id: string | null
          actor_label: string | null
          created_at: string
          details: Json
          document_id: string | null
          event: string
          id: string
          payment_id: string | null
          tenant_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_label?: string | null
          created_at?: string
          details?: Json
          document_id?: string | null
          event: string
          id?: string
          payment_id?: string | null
          tenant_id: string
        }
        Update: {
          actor_id?: string | null
          actor_label?: string | null
          created_at?: string
          details?: Json
          document_id?: string | null
          event?: string
          id?: string
          payment_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_activity_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "sales_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_activity_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_activity_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_activity_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_activity_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      document_files: {
        Row: {
          byte_size: number | null
          created_at: string
          created_by: string | null
          document_id: string | null
          file_hash: string | null
          id: string
          kind: string
          payment_id: string | null
          storage_path: string
          tenant_id: string
          version: number
        }
        Insert: {
          byte_size?: number | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          file_hash?: string | null
          id?: string
          kind?: string
          payment_id?: string | null
          storage_path: string
          tenant_id: string
          version?: number
        }
        Update: {
          byte_size?: number | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          file_hash?: string | null
          id?: string
          kind?: string
          payment_id?: string | null
          storage_path?: string
          tenant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_files_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "sales_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      document_sequences: {
        Row: {
          doc_type: string
          last_number: number
          period: string
          tenant_id: string
        }
        Insert: {
          doc_type: string
          last_number?: number
          period: string
          tenant_id: string
        }
        Update: {
          doc_type?: string
          last_number?: number
          period?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      document_versions: {
        Row: {
          created_at: string
          document_id: string
          finalized_at: string | null
          finalized_by: string | null
          id: string
          pdf_hash: string | null
          snapshot: Json
          tenant_id: string
          version: number
        }
        Insert: {
          created_at?: string
          document_id: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          pdf_hash?: string | null
          snapshot: Json
          tenant_id: string
          version: number
        }
        Update: {
          created_at?: string
          document_id?: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          pdf_hash?: string | null
          snapshot?: Json
          tenant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "sales_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      email_delivery_log: {
        Row: {
          created_at: string
          error: string | null
          from_address: string | null
          id: string
          meta: Json
          provider: string
          provider_msg_id: string | null
          recipient: string
          status: string
          subject: string | null
          template: string | null
          tenant_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          from_address?: string | null
          id?: string
          meta?: Json
          provider?: string
          provider_msg_id?: string | null
          recipient: string
          status?: string
          subject?: string | null
          template?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          from_address?: string | null
          id?: string
          meta?: Json
          provider?: string
          provider_msg_id?: string | null
          recipient?: string
          status?: string
          subject?: string | null
          template?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_delivery_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_delivery_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_delivery_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      error_events: {
        Row: {
          context: Json
          created_at: string
          id: string
          kind: string
          message: string
          release: string | null
          route: string | null
          session_id: string | null
          severity: string
          stack: string | null
          tenant_id: string | null
          url: string | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json
          created_at?: string
          id?: string
          kind?: string
          message: string
          release?: string | null
          route?: string | null
          session_id?: string | null
          severity?: string
          stack?: string | null
          tenant_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json
          created_at?: string
          id?: string
          kind?: string
          message?: string
          release?: string | null
          route?: string | null
          session_id?: string | null
          severity?: string
          stack?: string | null
          tenant_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "error_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      integration_errors: {
        Row: {
          account_id: string | null
          api_version: string | null
          feature: string | null
          fingerprint: string
          first_seen: string
          friendly_message: string
          friendly_title: string
          http_status: number | null
          id: string
          last_seen: string
          likely_cause: string | null
          occurrence_count: number
          operation: string | null
          platform: string
          provider_code: string | null
          provider_message: string | null
          provider_subcode: string | null
          provider_type: string | null
          recommended_fix: string | null
          resolved_at: string | null
          retryable: boolean
          severity: string
          tenant_id: string
        }
        Insert: {
          account_id?: string | null
          api_version?: string | null
          feature?: string | null
          fingerprint: string
          first_seen?: string
          friendly_message: string
          friendly_title: string
          http_status?: number | null
          id?: string
          last_seen?: string
          likely_cause?: string | null
          occurrence_count?: number
          operation?: string | null
          platform: string
          provider_code?: string | null
          provider_message?: string | null
          provider_subcode?: string | null
          provider_type?: string | null
          recommended_fix?: string | null
          resolved_at?: string | null
          retryable?: boolean
          severity?: string
          tenant_id: string
        }
        Update: {
          account_id?: string | null
          api_version?: string | null
          feature?: string | null
          fingerprint?: string
          first_seen?: string
          friendly_message?: string
          friendly_title?: string
          http_status?: number | null
          id?: string
          last_seen?: string
          likely_cause?: string | null
          occurrence_count?: number
          operation?: string | null
          platform?: string
          provider_code?: string | null
          provider_message?: string | null
          provider_subcode?: string | null
          provider_type?: string | null
          recommended_fix?: string | null
          resolved_at?: string | null
          retryable?: boolean
          severity?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_errors_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_errors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_errors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_errors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      invoice_templates: {
        Row: {
          accent_color: string
          created_at: string
          font_family: string
          id: string
          is_default: boolean
          logo_position: string
          logo_scale: number
          name: string
          options: Json
          primary_color: string
          secondary_color: string
          section_order: Json
          style: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          accent_color?: string
          created_at?: string
          font_family?: string
          id?: string
          is_default?: boolean
          logo_position?: string
          logo_scale?: number
          name: string
          options?: Json
          primary_color?: string
          secondary_color?: string
          section_order?: Json
          style?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          accent_color?: string
          created_at?: string
          font_family?: string
          id?: string
          is_default?: boolean
          logo_position?: string
          logo_scale?: number
          name?: string
          options?: Json
          primary_color?: string
          secondary_color?: string
          section_order?: Json
          style?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          due_date: string | null
          id: string
          invoice_number: string
          items: Json
          notes: string | null
          status: string
          subtotal: number
          tax_percent: number
          tenant_id: string
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          due_date?: string | null
          id?: string
          invoice_number: string
          items?: Json
          notes?: string | null
          status?: string
          subtotal?: number
          tax_percent?: number
          tenant_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string
          items?: Json
          notes?: string | null
          status?: string
          subtotal?: number
          tax_percent?: number
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      kpi_alerts: {
        Row: {
          created_at: string
          id: string
          label: string
          message: string
          metric: string
          resolved: boolean
          severity: string
          target_id: string | null
          target_value: number | null
          tenant_id: string
          value: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          message: string
          metric: string
          resolved?: boolean
          severity?: string
          target_id?: string | null
          target_value?: number | null
          tenant_id?: string
          value?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          message?: string
          metric?: string
          resolved?: boolean
          severity?: string
          target_id?: string | null
          target_value?: number | null
          tenant_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "kpi_alerts_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "kpi_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_targets: {
        Row: {
          active: boolean
          created_at: string
          direction: string
          id: string
          label: string
          last_checked_at: string | null
          last_value: number | null
          metric: string
          note: string | null
          source: string
          target_value: number
          tenant_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          direction?: string
          id?: string
          label: string
          last_checked_at?: string | null
          last_value?: number | null
          metric: string
          note?: string | null
          source?: string
          target_value: number
          tenant_id?: string
          unit?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          direction?: string
          id?: string
          label?: string
          last_checked_at?: string | null
          last_value?: number | null
          metric?: string
          note?: string | null
          source?: string
          target_value?: number
          tenant_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      lead_routing_rules: {
        Row: {
          active: boolean
          created_at: string
          id: string
          match_field: string
          match_value: string
          name: string
          priority: number
          tenant_id: string | null
          updated_at: string
          wa_number_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          match_field?: string
          match_value: string
          name: string
          priority?: number
          tenant_id?: string | null
          updated_at?: string
          wa_number_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          match_field?: string
          match_value?: string
          name?: string
          priority?: number
          tenant_id?: string | null
          updated_at?: string
          wa_number_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_routing_rules_wa_number_id_fkey"
            columns: ["wa_number_id"]
            isOneToOne: false
            referencedRelation: "wa_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_sites: {
        Row: {
          activated_at: string | null
          activation_token: string
          active: boolean
          admin_email: string | null
          ask_email: boolean
          ask_whatsapp: boolean
          created_at: string
          domain: string | null
          id: string
          name: string
          platform: string
          popup_greeting: string
          site_key: string
          status: string
          tenant_id: string | null
          webhook_secret: string
        }
        Insert: {
          activated_at?: string | null
          activation_token?: string
          active?: boolean
          admin_email?: string | null
          ask_email?: boolean
          ask_whatsapp?: boolean
          created_at?: string
          domain?: string | null
          id?: string
          name: string
          platform?: string
          popup_greeting?: string
          site_key?: string
          status?: string
          tenant_id?: string | null
          webhook_secret?: string
        }
        Update: {
          activated_at?: string | null
          activation_token?: string
          active?: boolean
          admin_email?: string | null
          ask_email?: boolean
          ask_whatsapp?: boolean
          created_at?: string
          domain?: string | null
          id?: string
          name?: string
          platform?: string
          popup_greeting?: string
          site_key?: string
          status?: string
          tenant_id?: string | null
          webhook_secret?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          assigned_to: string | null
          assigned_wa_number_id: string | null
          consent_at: string | null
          consent_given: boolean
          contact_id: string | null
          created_at: string
          custom_fields: Json
          email: string
          id: string
          lead_score: number
          name: string | null
          phone: string | null
          site_id: string | null
          source: string
          source_url: string | null
          status: string
          subscribed: boolean
          tags: string[]
          tenant_id: string
        }
        Insert: {
          assigned_to?: string | null
          assigned_wa_number_id?: string | null
          consent_at?: string | null
          consent_given?: boolean
          contact_id?: string | null
          created_at?: string
          custom_fields?: Json
          email: string
          id?: string
          lead_score?: number
          name?: string | null
          phone?: string | null
          site_id?: string | null
          source?: string
          source_url?: string | null
          status?: string
          subscribed?: boolean
          tags?: string[]
          tenant_id?: string
        }
        Update: {
          assigned_to?: string | null
          assigned_wa_number_id?: string | null
          consent_at?: string | null
          consent_given?: boolean
          contact_id?: string | null
          created_at?: string
          custom_fields?: Json
          email?: string
          id?: string
          lead_score?: number
          name?: string | null
          phone?: string | null
          site_id?: string | null
          source?: string
          source_url?: string | null
          status?: string
          subscribed?: boolean
          tags?: string[]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_assigned_wa_number_id_fkey"
            columns: ["assigned_wa_number_id"]
            isOneToOne: false
            referencedRelation: "wa_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "lead_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          detected_language: string | null
          direction: Database["public"]["Enums"]["msg_direction"]
          id: string
          media_url: string | null
          sender: Database["public"]["Enums"]["msg_sender"]
          sender_id: string | null
          status: string
          tenant_id: string
          translated_body: string | null
          wa_message_id: string | null
        }
        Insert: {
          body?: string
          conversation_id: string
          created_at?: string
          detected_language?: string | null
          direction: Database["public"]["Enums"]["msg_direction"]
          id?: string
          media_url?: string | null
          sender: Database["public"]["Enums"]["msg_sender"]
          sender_id?: string | null
          status?: string
          tenant_id?: string
          translated_body?: string | null
          wa_message_id?: string | null
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          detected_language?: string | null
          direction?: Database["public"]["Enums"]["msg_direction"]
          id?: string
          media_url?: string | null
          sender?: Database["public"]["Enums"]["msg_sender"]
          sender_id?: string | null
          status?: string
          tenant_id?: string
          translated_body?: string | null
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      oauth_states: {
        Row: {
          attempt_reason: string | null
          attempt_state: string
          code_verifier: string | null
          created_at: string
          expires_at: string
          id: string
          platform: string
          redirect_uri: string
          state: string | null
          state_hash: string | null
          tenant_id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          attempt_reason?: string | null
          attempt_state?: string
          code_verifier?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          platform: string
          redirect_uri: string
          state?: string | null
          state_hash?: string | null
          tenant_id?: string
          used_at?: string | null
          user_id?: string
        }
        Update: {
          attempt_reason?: string | null
          attempt_state?: string
          code_verifier?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          platform?: string
          redirect_uri?: string
          state?: string | null
          state_hash?: string | null
          tenant_id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          compliance_region: string | null
          country: string
          created_at: string
          currency: string
          id: string
          locale: string
          name: string
          paddle_customer_id: string | null
          paddle_subscription_id: string | null
          plan: string
          slug: string
          subscription_renews_at: string | null
          subscription_status: string
          suspended: boolean
          timezone: string
          updated_at: string
        }
        Insert: {
          compliance_region?: string | null
          country?: string
          created_at?: string
          currency?: string
          id?: string
          locale?: string
          name: string
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          plan?: string
          slug: string
          subscription_renews_at?: string | null
          subscription_status?: string
          suspended?: boolean
          timezone?: string
          updated_at?: string
        }
        Update: {
          compliance_region?: string | null
          country?: string
          created_at?: string
          currency?: string
          id?: string
          locale?: string
          name?: string
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          plan?: string
          slug?: string
          subscription_renews_at?: string | null
          subscription_status?: string
          suspended?: boolean
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      otp_attempts: {
        Row: {
          created_at: string
          email: string
          id: string
          ip_address: unknown
          kind: string
          reject_reason: string | null
          status: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          ip_address?: unknown
          kind: string
          reject_reason?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          ip_address?: unknown
          kind?: string
          reject_reason?: string | null
          status?: string
        }
        Relationships: []
      }
      payment_allocations: {
        Row: {
          amount: number
          created_at: string
          document_id: string
          id: string
          payment_id: string
          tenant_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          document_id: string
          id?: string
          payment_id: string
          tenant_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          document_id?: string
          id?: string
          payment_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "sales_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          attachment_url: string | null
          bank: string | null
          contact_id: string | null
          created_at: string
          credit_amount: number
          currency: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          paid_at: string
          receipt_number: string | null
          recorded_by: string | null
          reference: string | null
          tenant_id: string
        }
        Insert: {
          amount: number
          attachment_url?: string | null
          bank?: string | null
          contact_id?: string | null
          created_at?: string
          credit_amount?: number
          currency?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_at?: string
          receipt_number?: string | null
          recorded_by?: string | null
          reference?: string | null
          tenant_id: string
        }
        Update: {
          amount?: number
          attachment_url?: string | null
          bank?: string | null
          contact_id?: string | null
          created_at?: string
          credit_amount?: number
          currency?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_at?: string
          receipt_number?: string | null
          recorded_by?: string | null
          reference?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      plan_thresholds: {
        Row: {
          deliverability_min: number
          plan: string
          read_rate_min: number
          updated_at: string
        }
        Insert: {
          deliverability_min?: number
          plan: string
          read_rate_min?: number
          updated_at?: string
        }
        Update: {
          deliverability_min?: number
          plan?: string
          read_rate_min?: number
          updated_at?: string
        }
        Relationships: []
      }
      platform_apps: {
        Row: {
          client_id: string
          client_secret: string
          created_at: string
          id: string
          label: string | null
          provider: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          client_secret: string
          created_at?: string
          id?: string
          label?: string | null
          provider: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          client_secret?: string
          created_at?: string
          id?: string
          label?: string | null
          provider?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_apps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_apps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_apps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      platform_super_admins: {
        Row: {
          created_at: string
          email: string
        }
        Insert: {
          created_at?: string
          email: string
        }
        Update: {
          created_at?: string
          email?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          created_at: string
          description: string | null
          id: string
          images: string[]
          price: number | null
          sku: string | null
          specs: Json
          tenant_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          images?: string[]
          price?: number | null
          sku?: string | null
          specs?: Json
          tenant_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          images?: string[]
          price?: number | null
          sku?: string | null
          specs?: Json
          tenant_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          last_seen_at: string | null
          staff_role: Database["public"]["Enums"]["staff_role"]
          suspended: boolean
          suspended_at: string | null
          suspended_reason: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          last_seen_at?: string | null
          staff_role?: Database["public"]["Enums"]["staff_role"]
          suspended?: boolean
          suspended_at?: string | null
          suspended_reason?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          last_seen_at?: string | null
          staff_role?: Database["public"]["Enums"]["staff_role"]
          suspended?: boolean
          suspended_at?: string | null
          suspended_reason?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      reminders: {
        Row: {
          assigned_to: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          done: boolean
          due_at: string
          id: string
          note: string
          tenant_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          done?: boolean
          due_at: string
          id?: string
          note?: string
          tenant_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          done?: boolean
          due_at?: string
          id?: string
          note?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      sales_document_items: {
        Row: {
          created_at: string
          description_snapshot: string | null
          discount_amount: number
          discount_type: string
          discount_value: number
          document_id: string
          id: string
          image_snapshot: string | null
          line_total: number
          name_snapshot: string
          notes: string | null
          position: number
          product_id: string | null
          quantity: number
          serial_number: string | null
          service_period: string | null
          sku_snapshot: string | null
          tax_amount: number
          tax_rate: number
          tenant_id: string
          unit: string
          unit_price: number
          warranty: string | null
        }
        Insert: {
          created_at?: string
          description_snapshot?: string | null
          discount_amount?: number
          discount_type?: string
          discount_value?: number
          document_id: string
          id?: string
          image_snapshot?: string | null
          line_total?: number
          name_snapshot: string
          notes?: string | null
          position?: number
          product_id?: string | null
          quantity?: number
          serial_number?: string | null
          service_period?: string | null
          sku_snapshot?: string | null
          tax_amount?: number
          tax_rate?: number
          tenant_id: string
          unit?: string
          unit_price?: number
          warranty?: string | null
        }
        Update: {
          created_at?: string
          description_snapshot?: string | null
          discount_amount?: number
          discount_type?: string
          discount_value?: number
          document_id?: string
          id?: string
          image_snapshot?: string | null
          line_total?: number
          name_snapshot?: string
          notes?: string | null
          position?: number
          product_id?: string | null
          quantity?: number
          serial_number?: string | null
          service_period?: string | null
          sku_snapshot?: string | null
          tax_amount?: number
          tax_rate?: number
          tenant_id?: string
          unit?: string
          unit_price?: number
          warranty?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_document_items_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "sales_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_document_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_document_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_document_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_document_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      sales_documents: {
        Row: {
          acceptance: Json | null
          accepted_at: string | null
          additional_charges: number
          adjustment: number
          balance: number
          bank_account_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          company_snapshot: Json
          contact_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          custom_fields: Json
          customer_snapshot: Json
          doc_number: string
          due_date: string | null
          finalized_at: string | null
          finalized_by: string | null
          grand_total: number
          id: string
          invoice_discount: number
          issue_date: string
          item_discount_total: number
          kind: Database["public"]["Enums"]["sales_doc_kind"]
          last_sent_at: string | null
          lead_id: string | null
          notes: string | null
          original_invoice_id: string | null
          paid_amount: number
          payment_terms: string | null
          pdf_hash: string | null
          po_number: string | null
          quotation_id: string | null
          reference: string | null
          reminders_paused: boolean
          salesperson_id: string | null
          share_token: string | null
          shipping: number
          status: Database["public"]["Enums"]["sales_doc_status"]
          subtotal: number
          tax_inclusive: boolean
          tax_label: string
          tax_total: number
          taxable_amount: number
          template_id: string | null
          tenant_id: string
          terms: string | null
          updated_at: string
          valid_until: string | null
          verification_id: string | null
          verification_token: string | null
          version: number
          viewed_at: string | null
        }
        Insert: {
          acceptance?: Json | null
          accepted_at?: string | null
          additional_charges?: number
          adjustment?: number
          balance?: number
          bank_account_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          company_snapshot?: Json
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          custom_fields?: Json
          customer_snapshot?: Json
          doc_number: string
          due_date?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          grand_total?: number
          id?: string
          invoice_discount?: number
          issue_date?: string
          item_discount_total?: number
          kind: Database["public"]["Enums"]["sales_doc_kind"]
          last_sent_at?: string | null
          lead_id?: string | null
          notes?: string | null
          original_invoice_id?: string | null
          paid_amount?: number
          payment_terms?: string | null
          pdf_hash?: string | null
          po_number?: string | null
          quotation_id?: string | null
          reference?: string | null
          reminders_paused?: boolean
          salesperson_id?: string | null
          share_token?: string | null
          shipping?: number
          status?: Database["public"]["Enums"]["sales_doc_status"]
          subtotal?: number
          tax_inclusive?: boolean
          tax_label?: string
          tax_total?: number
          taxable_amount?: number
          template_id?: string | null
          tenant_id: string
          terms?: string | null
          updated_at?: string
          valid_until?: string | null
          verification_id?: string | null
          verification_token?: string | null
          version?: number
          viewed_at?: string | null
        }
        Update: {
          acceptance?: Json | null
          accepted_at?: string | null
          additional_charges?: number
          adjustment?: number
          balance?: number
          bank_account_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          company_snapshot?: Json
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          custom_fields?: Json
          customer_snapshot?: Json
          doc_number?: string
          due_date?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          grand_total?: number
          id?: string
          invoice_discount?: number
          issue_date?: string
          item_discount_total?: number
          kind?: Database["public"]["Enums"]["sales_doc_kind"]
          last_sent_at?: string | null
          lead_id?: string | null
          notes?: string | null
          original_invoice_id?: string | null
          paid_amount?: number
          payment_terms?: string | null
          pdf_hash?: string | null
          po_number?: string | null
          quotation_id?: string | null
          reference?: string | null
          reminders_paused?: boolean
          salesperson_id?: string | null
          share_token?: string | null
          shipping?: number
          status?: Database["public"]["Enums"]["sales_doc_status"]
          subtotal?: number
          tax_inclusive?: boolean
          tax_label?: string
          tax_total?: number
          taxable_amount?: number
          template_id?: string | null
          tenant_id?: string
          terms?: string | null
          updated_at?: string
          valid_until?: string | null
          verification_id?: string | null
          verification_token?: string | null
          version?: number
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_documents_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_documents_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_documents_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_documents_original_invoice_id_fkey"
            columns: ["original_invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_documents_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "sales_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_documents_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_documents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "invoice_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      seo_articles: {
        Row: {
          author_id: string | null
          content_html: string | null
          created_at: string
          excerpt: string | null
          featured_image_url: string | null
          id: string
          meta_description: string | null
          meta_title: string | null
          primary_keyword: string | null
          schema_markup: Json
          secondary_keywords: string[]
          seo_score: number
          slug: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
          wp_post_id: number | null
          wp_post_url: string | null
          wp_site_id: string | null
        }
        Insert: {
          author_id?: string | null
          content_html?: string | null
          created_at?: string
          excerpt?: string | null
          featured_image_url?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          primary_keyword?: string | null
          schema_markup?: Json
          secondary_keywords?: string[]
          seo_score?: number
          slug?: string | null
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
          wp_post_id?: number | null
          wp_post_url?: string | null
          wp_site_id?: string | null
        }
        Update: {
          author_id?: string | null
          content_html?: string | null
          created_at?: string
          excerpt?: string | null
          featured_image_url?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          primary_keyword?: string | null
          schema_markup?: Json
          secondary_keywords?: string[]
          seo_score?: number
          slug?: string | null
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          wp_post_id?: number | null
          wp_post_url?: string | null
          wp_site_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seo_articles_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seo_articles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seo_articles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seo_articles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "seo_articles_wp_site_id_fkey"
            columns: ["wp_site_id"]
            isOneToOne: false
            referencedRelation: "wordpress_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_otps: {
        Row: {
          attempts: number
          code_hash: string
          company_name: string | null
          consumed_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          purpose: string
          requested_ip: string | null
        }
        Insert: {
          attempts?: number
          code_hash: string
          company_name?: string | null
          consumed_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          purpose?: string
          requested_ip?: string | null
        }
        Update: {
          attempts?: number
          code_hash?: string
          company_name?: string | null
          consumed_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          purpose?: string
          requested_ip?: string | null
        }
        Relationships: []
      }
      social_account_scans: {
        Row: {
          account_id: string
          created_at: string
          findings: Json
          id: string
          overall: number
          scores: Json
          suggestions: Json
          tenant_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          findings?: Json
          id?: string
          overall?: number
          scores?: Json
          suggestions?: Json
          tenant_id?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          findings?: Json
          id?: string
          overall?: number
          scores?: Json
          suggestions?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_account_scans_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_accounts: {
        Row: {
          access_token: string | null
          active: boolean
          connect_method: string
          connection_state: string
          created_at: string
          external_id: string | null
          granted_scopes: string[] | null
          health: string
          id: string
          label: string
          last_analytics_sync_at: string | null
          last_error: string | null
          last_error_at: string | null
          last_post_at: string | null
          last_retry_at: string | null
          last_synced_at: string | null
          next_retry_at: string | null
          permissions: Json
          platform: string
          profile: Json
          profile_url: string | null
          refresh_token: string | null
          retry_count: number
          state_changed_at: string
          state_reason: string | null
          stats: Json
          status_reason: string | null
          tenant_id: string
          token_expires_at: string | null
        }
        Insert: {
          access_token?: string | null
          active?: boolean
          connect_method?: string
          connection_state?: string
          created_at?: string
          external_id?: string | null
          granted_scopes?: string[] | null
          health?: string
          id?: string
          label: string
          last_analytics_sync_at?: string | null
          last_error?: string | null
          last_error_at?: string | null
          last_post_at?: string | null
          last_retry_at?: string | null
          last_synced_at?: string | null
          next_retry_at?: string | null
          permissions?: Json
          platform: string
          profile?: Json
          profile_url?: string | null
          refresh_token?: string | null
          retry_count?: number
          state_changed_at?: string
          state_reason?: string | null
          stats?: Json
          status_reason?: string | null
          tenant_id?: string
          token_expires_at?: string | null
        }
        Update: {
          access_token?: string | null
          active?: boolean
          connect_method?: string
          connection_state?: string
          created_at?: string
          external_id?: string | null
          granted_scopes?: string[] | null
          health?: string
          id?: string
          label?: string
          last_analytics_sync_at?: string | null
          last_error?: string | null
          last_error_at?: string | null
          last_post_at?: string | null
          last_retry_at?: string | null
          last_synced_at?: string | null
          next_retry_at?: string | null
          permissions?: Json
          platform?: string
          profile?: Json
          profile_url?: string | null
          refresh_token?: string | null
          retry_count?: number
          state_changed_at?: string
          state_reason?: string | null
          stats?: Json
          status_reason?: string | null
          tenant_id?: string
          token_expires_at?: string | null
        }
        Relationships: []
      }
      social_capabilities: {
        Row: {
          account_id: string
          capability: string
          detail: string | null
          id: string
          missing_scopes: string[]
          permission_state: string
          required_scopes: string[]
          status: string
          tenant_id: string
          test_outcome: string | null
          tested_at: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          capability: string
          detail?: string | null
          id?: string
          missing_scopes?: string[]
          permission_state?: string
          required_scopes?: string[]
          status?: string
          tenant_id: string
          test_outcome?: string | null
          tested_at?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          capability?: string
          detail?: string | null
          id?: string
          missing_scopes?: string[]
          permission_state?: string
          required_scopes?: string[]
          status?: string
          tenant_id?: string
          test_outcome?: string | null
          tested_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_capabilities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_capabilities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_capabilities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_capabilities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      social_connection_tests: {
        Row: {
          account_id: string
          duration_ms: number | null
          finished_at: string | null
          health_score: number | null
          id: string
          started_at: string
          summary: string | null
          tenant_id: string
          trigger: string
          triggered_by: string | null
          verdict: string | null
        }
        Insert: {
          account_id: string
          duration_ms?: number | null
          finished_at?: string | null
          health_score?: number | null
          id?: string
          started_at?: string
          summary?: string | null
          tenant_id: string
          trigger?: string
          triggered_by?: string | null
          verdict?: string | null
        }
        Update: {
          account_id?: string
          duration_ms?: number | null
          finished_at?: string | null
          health_score?: number | null
          id?: string
          started_at?: string
          summary?: string | null
          tenant_id?: string
          trigger?: string
          triggered_by?: string | null
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_connection_tests_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_connection_tests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_connection_tests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_connection_tests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      social_interactions: {
        Row: {
          account_id: string
          ai_suggestion: string | null
          author_handle: string | null
          author_name: string | null
          body: string
          created_at: string
          direction: string
          external_id: string | null
          id: string
          kind: string
          replied_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          account_id: string
          ai_suggestion?: string | null
          author_handle?: string | null
          author_name?: string | null
          body: string
          created_at?: string
          direction?: string
          external_id?: string | null
          id?: string
          kind: string
          replied_at?: string | null
          status?: string
          tenant_id?: string
        }
        Update: {
          account_id?: string
          ai_suggestion?: string | null
          author_handle?: string | null
          author_name?: string | null
          body?: string
          created_at?: string
          direction?: string
          external_id?: string | null
          id?: string
          kind?: string
          replied_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_interactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          account_id: string | null
          caption: string
          comments_count: number
          created_at: string
          external_id: string | null
          id: string
          likes: number
          published_at: string | null
          reach: number
          scheduled_at: string | null
          shares: number
          status: string
          tenant_id: string
        }
        Insert: {
          account_id?: string | null
          caption: string
          comments_count?: number
          created_at?: string
          external_id?: string | null
          id?: string
          likes?: number
          published_at?: string | null
          reach?: number
          scheduled_at?: string | null
          shares?: number
          status?: string
          tenant_id?: string
        }
        Update: {
          account_id?: string | null
          caption?: string
          comments_count?: number
          created_at?: string
          external_id?: string | null
          id?: string
          likes?: number
          published_at?: string | null
          reach?: number
          scheduled_at?: string | null
          shares?: number
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_test_results: {
        Row: {
          check_key: string
          created_at: string
          detail: string | null
          duration_ms: number | null
          http_status: number | null
          id: string
          label: string
          outcome: string
          position: number
          provider_code: string | null
          tenant_id: string
          test_id: string
        }
        Insert: {
          check_key: string
          created_at?: string
          detail?: string | null
          duration_ms?: number | null
          http_status?: number | null
          id?: string
          label: string
          outcome: string
          position?: number
          provider_code?: string | null
          tenant_id: string
          test_id: string
        }
        Update: {
          check_key?: string
          created_at?: string
          detail?: string | null
          duration_ms?: number | null
          http_status?: number | null
          id?: string
          label?: string
          outcome?: string
          position?: number
          provider_code?: string | null
          tenant_id?: string
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_test_results_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_test_results_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_test_results_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "social_test_results_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "social_connection_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          paddle_customer_id: string
          paddle_subscription_id: string
          price_id: string
          product_id: string
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          paddle_customer_id: string
          paddle_subscription_id: string
          price_id: string
          product_id: string
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          paddle_customer_id?: string
          paddle_subscription_id?: string
          price_id?: string
          product_id?: string
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      system_alerts: {
        Row: {
          created_at: string
          id: string
          message: string | null
          resolved: boolean
          severity: string
          source: string
          tenant_id: string | null
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          resolved?: boolean
          severity?: string
          source?: string
          tenant_id?: string | null
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          resolved?: boolean
          severity?: string
          source?: string
          tenant_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      tax_rates: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          label: string
          rate: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          label: string
          rate?: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string
          rate?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_rates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_rates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_rates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      team_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          id: string
          invited_by: string | null
          staff_role: Database["public"]["Enums"]["staff_role"]
          status: string
          tenant_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          staff_role?: Database["public"]["Enums"]["staff_role"]
          status?: string
          tenant_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          staff_role?: Database["public"]["Enums"]["staff_role"]
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      tenant_bot_settings: {
        Row: {
          bot_name: string
          business_hours_only: boolean
          enabled: boolean
          greeting: string
          handoff_keywords: string[]
          instructions: string
          model: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          bot_name?: string
          business_hours_only?: boolean
          enabled?: boolean
          greeting?: string
          handoff_keywords?: string[]
          instructions?: string
          model?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          bot_name?: string
          business_hours_only?: boolean
          enabled?: boolean
          greeting?: string
          handoff_keywords?: string[]
          instructions?: string
          model?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_bot_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_bot_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_bot_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      tenant_smtp_config: {
        Row: {
          api_key_enc: string | null
          created_at: string
          created_by: string | null
          domain: string | null
          from_email: string | null
          from_name: string | null
          last_test_at: string | null
          last_test_error: string | null
          last_test_ok: boolean | null
          provider: string
          region: string | null
          reply_to: string | null
          tenant_id: string
          updated_at: string
          verified: boolean
          webhook_secret: string | null
        }
        Insert: {
          api_key_enc?: string | null
          created_at?: string
          created_by?: string | null
          domain?: string | null
          from_email?: string | null
          from_name?: string | null
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_ok?: boolean | null
          provider?: string
          region?: string | null
          reply_to?: string | null
          tenant_id: string
          updated_at?: string
          verified?: boolean
          webhook_secret?: string | null
        }
        Update: {
          api_key_enc?: string | null
          created_at?: string
          created_by?: string | null
          domain?: string | null
          from_email?: string | null
          from_name?: string | null
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_ok?: boolean | null
          provider?: string
          region?: string | null
          reply_to?: string | null
          tenant_id?: string
          updated_at?: string
          verified?: boolean
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_smtp_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_smtp_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_smtp_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      tenant_wa_config: {
        Row: {
          business_name: string | null
          display_phone: string | null
          phone_number_id: string | null
          tenant_id: string
          updated_at: string
          webhook_verified: boolean
        }
        Insert: {
          business_name?: string | null
          display_phone?: string | null
          phone_number_id?: string | null
          tenant_id: string
          updated_at?: string
          webhook_verified?: boolean
        }
        Update: {
          business_name?: string | null
          display_phone?: string | null
          phone_number_id?: string | null
          tenant_id?: string
          updated_at?: string
          webhook_verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "tenant_wa_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_wa_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_wa_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wa_config: {
        Row: {
          business_name: string | null
          display_phone: string | null
          id: boolean
          phone_number_id: string | null
          updated_at: string
          webhook_verified: boolean
        }
        Insert: {
          business_name?: string | null
          display_phone?: string | null
          id?: boolean
          phone_number_id?: string | null
          updated_at?: string
          webhook_verified?: boolean
        }
        Update: {
          business_name?: string | null
          display_phone?: string | null
          id?: boolean
          phone_number_id?: string | null
          updated_at?: string
          webhook_verified?: boolean
        }
        Relationships: []
      }
      wa_numbers: {
        Row: {
          access_token: string
          active: boolean
          alerts_enabled: boolean
          app_secret: string | null
          created_at: string
          deliverability_min: number | null
          display_phone: string | null
          id: string
          is_default: boolean
          label: string
          phone_number_id: string
          read_rate_min: number | null
          tenant_id: string
        }
        Insert: {
          access_token: string
          active?: boolean
          alerts_enabled?: boolean
          app_secret?: string | null
          created_at?: string
          deliverability_min?: number | null
          display_phone?: string | null
          id?: string
          is_default?: boolean
          label: string
          phone_number_id: string
          read_rate_min?: number | null
          tenant_id?: string
        }
        Update: {
          access_token?: string
          active?: boolean
          alerts_enabled?: boolean
          app_secret?: string | null
          created_at?: string
          deliverability_min?: number | null
          display_phone?: string | null
          id?: string
          is_default?: boolean
          label?: string
          phone_number_id?: string
          read_rate_min?: number | null
          tenant_id?: string
        }
        Relationships: []
      }
      wa_templates: {
        Row: {
          body: string
          category: string
          created_at: string
          footer: string | null
          header: string | null
          id: string
          language: string
          meta_template_id: string | null
          name: string
          rejection_reason: string | null
          reviewed_at: string | null
          status: string
          submitted_at: string | null
          tenant_id: string
          updated_at: string
          variables: string[]
          wa_number_id: string | null
        }
        Insert: {
          body?: string
          category?: string
          created_at?: string
          footer?: string | null
          header?: string | null
          id?: string
          language?: string
          meta_template_id?: string | null
          name: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          status?: string
          submitted_at?: string | null
          tenant_id?: string
          updated_at?: string
          variables?: string[]
          wa_number_id?: string | null
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          footer?: string | null
          header?: string | null
          id?: string
          language?: string
          meta_template_id?: string | null
          name?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          status?: string
          submitted_at?: string | null
          tenant_id?: string
          updated_at?: string
          variables?: string[]
          wa_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "wa_templates_wa_number_id_fkey"
            columns: ["wa_number_id"]
            isOneToOne: false
            referencedRelation: "wa_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_dedup: {
        Row: {
          event_id: string
          event_source: string
          seen_at: string
        }
        Insert: {
          event_id: string
          event_source: string
          seen_at?: string
        }
        Update: {
          event_id?: string
          event_source?: string
          seen_at?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          attempts: number
          created_at: string
          duration_ms: number | null
          error: string | null
          event_type: string
          id: string
          last_retry_at: string | null
          payload: Json
          processed_at: string | null
          source: string
          status: string
          tenant_id: string | null
          wa_message_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          event_type?: string
          id?: string
          last_retry_at?: string | null
          payload?: Json
          processed_at?: string | null
          source?: string
          status?: string
          tenant_id?: string | null
          wa_message_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          event_type?: string
          id?: string
          last_retry_at?: string | null
          payload?: Json
          processed_at?: string | null
          source?: string
          status?: string
          tenant_id?: string | null
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
      website_pages: {
        Row: {
          id: string
          indexed_at: string
          keywords: string | null
          kind: string
          summary: string | null
          tenant_id: string
          title: string | null
          url: string
          word_count: number
        }
        Insert: {
          id?: string
          indexed_at?: string
          keywords?: string | null
          kind?: string
          summary?: string | null
          tenant_id?: string
          title?: string | null
          url: string
          word_count?: number
        }
        Update: {
          id?: string
          indexed_at?: string
          keywords?: string | null
          kind?: string
          summary?: string | null
          tenant_id?: string
          title?: string | null
          url?: string
          word_count?: number
        }
        Relationships: []
      }
      website_sync_state: {
        Row: {
          blog_posts: number
          error: string | null
          last_synced_at: string | null
          pages: number
          products: number
          services: number
          site_url: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          blog_posts?: number
          error?: string | null
          last_synced_at?: string | null
          pages?: number
          products?: number
          services?: number
          site_url?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          blog_posts?: number
          error?: string | null
          last_synced_at?: string | null
          pages?: number
          products?: number
          services?: number
          site_url?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      wordpress_sites: {
        Row: {
          app_password: string
          created_at: string
          created_by: string | null
          default_author: string | null
          id: string
          label: string
          seo_plugin: string
          site_url: string
          tenant_id: string
          username: string
        }
        Insert: {
          app_password: string
          created_at?: string
          created_by?: string | null
          default_author?: string | null
          id?: string
          label: string
          seo_plugin?: string
          site_url: string
          tenant_id: string
          username: string
        }
        Update: {
          app_password?: string
          created_at?: string
          created_by?: string | null
          default_author?: string | null
          id?: string
          label?: string
          seo_plugin?: string
          site_url?: string
          tenant_id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "wordpress_sites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "company_billing_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wordpress_sites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wordpress_sites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "super_admin_subscribers"
            referencedColumns: ["tenant_id"]
          },
        ]
      }
    }
    Views: {
      company_billing_overview: {
        Row: {
          billing_state: string | null
          contacts: number | null
          created_at: string | null
          days_remaining: number | null
          id: string | null
          last_active: string | null
          members: number | null
          members_suspended: number | null
          messages: number | null
          name: string | null
          paid_until: string | null
          plan: string | null
          slug: string | null
          subscription_status: string | null
          subscription_renews_at: string | null
          suspended: boolean | null
        }
        Insert: {
          billing_state?: never
          contacts?: never
          created_at?: string | null
          days_remaining?: never
          id?: string | null
          last_active?: never
          members?: never
          members_suspended?: never
          messages?: never
          name?: string | null
          paid_until?: string | null
          plan?: string | null
          slug?: string | null
          subscription_status?: string | null
          subscription_renews_at?: string | null
          suspended?: boolean | null
        }
        Update: {
          billing_state?: never
          contacts?: never
          created_at?: string | null
          days_remaining?: never
          id?: string | null
          last_active?: never
          members?: never
          members_suspended?: never
          messages?: never
          name?: string | null
          paid_until?: string | null
          plan?: string | null
          slug?: string | null
          subscription_status?: string | null
          subscription_renews_at?: string | null
          suspended?: boolean | null
        }
        Relationships: []
      }
      super_admin_subscribers: {
        Row: {
          active_social_accounts: number | null
          active_wa_numbers: number | null
          company_created_at: string | null
          company_name: string | null
          contacts_count: number | null
          country: string | null
          currency: string | null
          last_message_at: string | null
          messages_count: number | null
          paddle_customer_id: string | null
          paddle_subscription_id: string | null
          plan: string | null
          slug: string | null
          staff_count: number | null
          subscription_renews_at: string | null
          subscription_status: string | null
          suspended: boolean | null
          tenant_id: string | null
        }
        Insert: {
          active_social_accounts?: never
          active_wa_numbers?: never
          company_created_at?: string | null
          company_name?: string | null
          contacts_count?: never
          country?: string | null
          currency?: string | null
          last_message_at?: never
          messages_count?: never
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          plan?: string | null
          slug?: string | null
          staff_count?: never
          subscription_renews_at?: string | null
          subscription_status?: string | null
          suspended?: boolean | null
          tenant_id?: string | null
        }
        Update: {
          active_social_accounts?: never
          active_wa_numbers?: never
          company_created_at?: string | null
          company_name?: string | null
          contacts_count?: never
          country?: string | null
          currency?: string | null
          last_message_at?: never
          messages_count?: never
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          plan?: string | null
          slug?: string | null
          staff_count?: never
          subscription_renews_at?: string | null
          subscription_status?: string | null
          suspended?: boolean | null
          tenant_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _is_locked_super_admin_email: {
        Args: { _email: string }
        Returns: boolean
      }
      _smtp_encryption_key: { Args: never; Returns: string }
      access_state: { Args: { _user?: string }; Returns: string }
      am_i_super_admin: { Args: never; Returns: boolean }
      am_i_tenant_admin: { Args: never; Returns: boolean }
      check_ai_rate_limit: {
        Args: {
          _max_per_day?: number
          _max_per_hour?: number
          _tenant_id: string
        }
        Returns: {
          allowed: boolean
          reason: string
          used_day: number
          used_hour: number
        }[]
      }
      check_auth_email_attempt: {
        Args: { _action_type: string; _recipient_email: string }
        Returns: {
          allowed: boolean
          attempt_number: number
          retry_after_seconds: number
        }[]
      }
      check_otp_attempt: {
        Args: { _email: string; _ip?: string; _kind: string }
        Returns: {
          allowed: boolean
          attempts_last_hour: number
          reject_reason: string
          seconds_until_next: number
        }[]
      }
      consume_oauth_state: {
        Args: { _state: string }
        Returns: {
          code_verifier: string
          id: string
          platform: string
          redirect_uri: string
          tenant_id: string
          user_id: string
        }[]
      }
      consume_oauth_state_hash: {
        Args: { _state_hash: string }
        Returns: {
          code_verifier: string
          id: string
          platform: string
          redirect_uri: string
          tenant_id: string
          user_id: string
        }[]
      }
      current_tenant_id: { Args: never; Returns: string }
      expire_abandoned_oauth_attempts: {
        Args: never
        Returns: {
          deleted_count: number
          expired_count: number
        }[]
      }
      get_tenant_ai_key: {
        Args: { _tenant_id: string }
        Returns: {
          api_key: string
          provider: string
        }[]
      }
      get_tenant_smtp_api_key: { Args: { _tenant_id: string }; Returns: string }
      has_active_subscription: {
        Args: { check_env?: string; user_uuid: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_unread_count: {
        Args: { _conversation_id: string }
        Returns: number
      }
      is_legal_connection_transition: {
        Args: { _from: string; _to: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user?: string }; Returns: boolean }
      is_tenant_admin: { Args: { _user?: string }; Returns: boolean }
      list_subscribers: {
        Args: never
        Returns: {
          active_social_accounts: number | null
          active_wa_numbers: number | null
          company_created_at: string | null
          company_name: string | null
          contacts_count: number | null
          country: string | null
          currency: string | null
          last_message_at: string | null
          messages_count: number | null
          paddle_customer_id: string | null
          paddle_subscription_id: string | null
          plan: string | null
          slug: string | null
          staff_count: number | null
          subscription_renews_at: string | null
          subscription_status: string | null
          suspended: boolean | null
          tenant_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "super_admin_subscribers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      log_email_delivery: {
        Args: {
          _error?: string
          _from_address: string
          _meta?: Json
          _provider: string
          _provider_msg_id: string
          _recipient: string
          _status: string
          _subject: string
          _template: string
          _tenant_id: string
          _user_id: string
        }
        Returns: string
      }
      mark_wa_webhook_verified: {
        Args: { _tenant_id: string }
        Returns: undefined
      }
      my_tenant_id: { Args: never; Returns: string }
      next_document_number: {
        Args: { _doc_type: string; _tenant_id: string }
        Returns: string
      }
      normalize_contact_identity: {
        Args: { _kind: string; _value: string }
        Returns: string
      }
      purge_expired_oauth_states: { Args: never; Returns: number }
      record_ai_usage: {
        Args: {
          _duration_ms: number
          _feature: string
          _ok: boolean
          _provider: string
          _tenant_id: string
          _user_id: string
        }
        Returns: undefined
      }
      record_integration_error: {
        Args: {
          _account_id: string
          _api_version: string
          _feature: string
          _fingerprint: string
          _friendly_message: string
          _friendly_title: string
          _http_status: number
          _likely_cause: string
          _operation: string
          _platform: string
          _provider_code: string
          _provider_message: string
          _provider_subcode: string
          _provider_type: string
          _recommended_fix: string
          _retryable: boolean
          _severity: string
          _tenant_id: string
        }
        Returns: string
      }
      record_otp_attempt: {
        Args: {
          _email: string
          _ip: string
          _kind: string
          _reject_reason?: string
          _status: string
        }
        Returns: string
      }
      replace_sales_document_items: {
        Args: { _document_id: string; _items: Json; _tenant_id: string }
        Returns: undefined
      }
      resolve_contact_by_identity: {
        Args: { _kind: string; _tenant_id: string; _value: string }
        Returns: {
          branch_id: string
          contact_id: string
        }[]
      }
      rotate_site_webhook_secret: {
        Args: { _site_id: string }
        Returns: string
      }
      rotate_wa_number_app_secret: {
        Args: { _new_secret: string; _wa_number_id: string }
        Returns: boolean
      }
      set_tenant_smtp_api_key: {
        Args: { _api_key: string }
        Returns: undefined
      }
      try_lock_connection_refresh: {
        Args: { _account_id: string }
        Returns: boolean
      }
      update_email_delivery: {
        Args: {
          _error?: string
          _new_status: string
          _provider: string
          _provider_msg_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "agent"
      conv_channel: "whatsapp" | "web"
      conv_status: "open" | "pending" | "closed"
      lead_stage:
        | "new"
        | "qualified"
        | "proposal"
        | "negotiation"
        | "won"
        | "lost"
      msg_direction: "inbound" | "outbound"
      msg_sender: "contact" | "agent" | "bot"
      payment_method:
        | "cash"
        | "bank_transfer"
        | "credit_card"
        | "cheque"
        | "online"
        | "other"
      sales_doc_kind: "quotation" | "invoice" | "credit_note" | "proforma"
      sales_doc_status:
        | "draft"
        | "pending_approval"
        | "sent"
        | "viewed"
        | "partially_paid"
        | "paid"
        | "overdue"
        | "cancelled"
        | "refunded"
        | "accepted"
        | "rejected"
        | "expired"
        | "converted"
      staff_role:
        | "super_admin"
        | "company_admin"
        | "marketing_manager"
        | "staff"
        | "seo_editor"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "agent"],
      conv_channel: ["whatsapp", "web"],
      conv_status: ["open", "pending", "closed"],
      lead_stage: [
        "new",
        "qualified",
        "proposal",
        "negotiation",
        "won",
        "lost",
      ],
      msg_direction: ["inbound", "outbound"],
      msg_sender: ["contact", "agent", "bot"],
      payment_method: [
        "cash",
        "bank_transfer",
        "credit_card",
        "cheque",
        "online",
        "other",
      ],
      sales_doc_kind: ["quotation", "invoice", "credit_note", "proforma"],
      sales_doc_status: [
        "draft",
        "pending_approval",
        "sent",
        "viewed",
        "partially_paid",
        "paid",
        "overdue",
        "cancelled",
        "refunded",
        "accepted",
        "rejected",
        "expired",
        "converted",
      ],
      staff_role: [
        "super_admin",
        "company_admin",
        "marketing_manager",
        "staff",
        "seo_editor",
      ],
    },
  },
} as const
