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
    PostgrestVersion: "14.17"
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
        }
        Relationships: []
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "contacts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
        ]
      }
      oauth_states: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          platform: string
          redirect_uri: string
          state: string
          tenant_id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          platform: string
          redirect_uri: string
          state: string
          tenant_id?: string
          used_at?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          platform?: string
          redirect_uri?: string
          state?: string
          tenant_id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          paddle_customer_id: string | null
          paddle_subscription_id: string | null
          plan: string
          slug: string
          subscription_renews_at: string | null
          subscription_status: string
          suspended: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          plan?: string
          slug: string
          subscription_renews_at?: string | null
          subscription_status?: string
          suspended?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          plan?: string
          slug?: string
          subscription_renews_at?: string | null
          subscription_status?: string
          suspended?: boolean
          updated_at?: string
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
          created_at: string
          external_id: string | null
          health: string
          id: string
          label: string
          last_analytics_sync_at: string | null
          last_post_at: string | null
          last_synced_at: string | null
          permissions: Json
          platform: string
          profile: Json
          profile_url: string | null
          stats: Json
          tenant_id: string
          token_expires_at: string | null
        }
        Insert: {
          access_token?: string | null
          active?: boolean
          connect_method?: string
          created_at?: string
          external_id?: string | null
          health?: string
          id?: string
          label: string
          last_analytics_sync_at?: string | null
          last_post_at?: string | null
          last_synced_at?: string | null
          permissions?: Json
          platform: string
          profile?: Json
          profile_url?: string | null
          stats?: Json
          tenant_id?: string
          token_expires_at?: string | null
        }
        Update: {
          access_token?: string | null
          active?: boolean
          connect_method?: string
          created_at?: string
          external_id?: string | null
          health?: string
          id?: string
          label?: string
          last_analytics_sync_at?: string | null
          last_post_at?: string | null
          last_synced_at?: string | null
          permissions?: Json
          platform?: string
          profile?: Json
          profile_url?: string | null
          stats?: Json
          tenant_id?: string
          token_expires_at?: string | null
        }
        Relationships: []
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
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          resolved?: boolean
          severity?: string
          source?: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          resolved?: boolean
          severity?: string
          source?: string
          title?: string
        }
        Relationships: []
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
          updated_at?: string
          variables?: string[]
          wa_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
          wa_message_id?: string | null
        }
        Relationships: []
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
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_tenant_id: { Args: never; Returns: string }
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
      next_document_number: {
        Args: { _doc_type: string; _tenant_id: string }
        Returns: string
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
