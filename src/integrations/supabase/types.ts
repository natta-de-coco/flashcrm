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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
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
          updated_at: string
          value: number
        }
        Insert: {
          company?: string | null
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
          updated_at?: string
          value?: number
        }
        Update: {
          company?: string | null
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
          updated_at?: string
          value?: number
        }
        Relationships: []
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
        ]
      }
      lead_sites: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          platform: string
          site_key: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          platform?: string
          site_key?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          platform?: string
          site_key?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          contact_id: string | null
          created_at: string
          email: string
          id: string
          name: string | null
          phone: string | null
          site_id: string | null
          source: string
          source_url: string | null
          subscribed: boolean
          tags: string[]
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          email: string
          id?: string
          name?: string | null
          phone?: string | null
          site_id?: string | null
          source?: string
          source_url?: string | null
          subscribed?: boolean
          tags?: string[]
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string | null
          phone?: string | null
          site_id?: string | null
          source?: string
          source_url?: string | null
          subscribed?: boolean
          tags?: string[]
        }
        Relationships: [
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
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["msg_direction"]
          id: string
          media_url: string | null
          sender: Database["public"]["Enums"]["msg_sender"]
          sender_id: string | null
          status: string
          wa_message_id: string | null
        }
        Insert: {
          body?: string
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["msg_direction"]
          id?: string
          media_url?: string | null
          sender: Database["public"]["Enums"]["msg_sender"]
          sender_id?: string | null
          status?: string
          wa_message_id?: string | null
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["msg_direction"]
          id?: string
          media_url?: string | null
          sender?: Database["public"]["Enums"]["msg_sender"]
          sender_id?: string | null
          status?: string
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
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
      wa_templates: {
        Row: {
          body: string
          category: string
          created_at: string
          footer: string | null
          header: string | null
          id: string
          language: string
          name: string
          status: string
          updated_at: string
          variables: string[]
        }
        Insert: {
          body?: string
          category?: string
          created_at?: string
          footer?: string | null
          header?: string | null
          id?: string
          language?: string
          name: string
          status?: string
          updated_at?: string
          variables?: string[]
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          footer?: string | null
          header?: string | null
          id?: string
          language?: string
          name?: string
          status?: string
          updated_at?: string
          variables?: string[]
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
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
    },
  },
} as const
