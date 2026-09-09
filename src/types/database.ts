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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      customer_billing_agreements: {
        Row: {
          bill_in_advance: boolean
          billing_cycle_day: number
          created_at: string
          customer_id: string
          effective_date: string
          end_date: string | null
          id: string
          included_hours: number
          is_active: boolean
          monthly_fee: number
          overage_hourly_rate: number
          rollover_enabled: boolean
          rounding_increment_minutes: number
          updated_at: string
        }
        Insert: {
          bill_in_advance?: boolean
          billing_cycle_day?: number
          created_at?: string
          customer_id: string
          effective_date: string
          end_date?: string | null
          id?: string
          included_hours: number
          is_active?: boolean
          monthly_fee: number
          overage_hourly_rate: number
          rollover_enabled?: boolean
          rounding_increment_minutes?: number
          updated_at?: string
        }
        Update: {
          bill_in_advance?: boolean
          billing_cycle_day?: number
          created_at?: string
          customer_id?: string
          effective_date?: string
          end_date?: string | null
          id?: string
          included_hours?: number
          is_active?: boolean
          monthly_fee?: number
          overage_hourly_rate?: number
          rollover_enabled?: boolean
          rounding_increment_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_billing_agreements_customer_fk"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          billing_address_line1: string | null
          billing_address_line2: string | null
          billing_city: string | null
          billing_country: string | null
          billing_postal_code: string | null
          billing_state: string | null
          company_name: string
          created_at: string
          default_payment_terms_days: number
          email: string | null
          id: string
          is_active: boolean
          notes: string | null
          phone: string | null
          primary_contact_name: string | null
          updated_at: string
        }
        Insert: {
          billing_address_line1?: string | null
          billing_address_line2?: string | null
          billing_city?: string | null
          billing_country?: string | null
          billing_postal_code?: string | null
          billing_state?: string | null
          company_name: string
          created_at?: string
          default_payment_terms_days?: number
          email?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          phone?: string | null
          primary_contact_name?: string | null
          updated_at?: string
        }
        Update: {
          billing_address_line1?: string | null
          billing_address_line2?: string | null
          billing_city?: string | null
          billing_country?: string | null
          billing_postal_code?: string | null
          billing_state?: string | null
          company_name?: string
          created_at?: string
          default_payment_terms_days?: number
          email?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          phone?: string | null
          primary_contact_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      running_timers: {
        Row: {
          created_at: string
          customer_id: string
          description: string
          hourly_rate: number | null
          id: string
          is_billable: boolean
          started_at: string
          stop_requested_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          description: string
          hourly_rate?: number | null
          id?: string
          is_billable: boolean
          started_at: string
          stop_requested_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          description?: string
          hourly_rate?: number | null
          id?: string
          is_billable?: boolean
          started_at?: string
          stop_requested_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "running_timers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          actual_minutes: number
          billing_agreement_id: string | null
          billing_cycle_day_snapshot: number | null
          created_at: string
          customer_id: string
          description: string
          ended_at: string | null
          hourly_rate: number | null
          id: string
          included_hours_snapshot: number | null
          is_billable: boolean
          rollover_enabled_snapshot: boolean | null
          rounded_minutes: number
          rounding_increment_minutes: number
          started_at: string | null
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          work_date: string
        }
        Insert: {
          actual_minutes: number
          billing_agreement_id?: string | null
          billing_cycle_day_snapshot?: number | null
          created_at?: string
          customer_id: string
          description: string
          ended_at?: string | null
          hourly_rate?: number | null
          id?: string
          included_hours_snapshot?: number | null
          is_billable?: boolean
          rollover_enabled_snapshot?: boolean | null
          rounded_minutes?: number
          rounding_increment_minutes?: number
          started_at?: string | null
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          work_date: string
        }
        Update: {
          actual_minutes?: number
          billing_agreement_id?: string | null
          billing_cycle_day_snapshot?: number | null
          created_at?: string
          customer_id?: string
          description?: string
          ended_at?: string | null
          hourly_rate?: number | null
          id?: string
          included_hours_snapshot?: number | null
          is_billable?: boolean
          rollover_enabled_snapshot?: boolean | null
          rounded_minutes?: number
          rounding_increment_minutes?: number
          started_at?: string | null
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_agreement_customer_fk"
            columns: ["billing_agreement_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customer_billing_agreements"
            referencedColumns: ["id", "customer_id"]
          },
          {
            foreignKeyName: "time_entries_customer_fk"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      unbilled_time_entries: {
        Row: {
          actual_minutes: number | null
          billing_agreement_id: string | null
          billing_cycle_day_snapshot: number | null
          created_at: string | null
          customer_id: string | null
          description: string | null
          ended_at: string | null
          hourly_rate: number | null
          id: string | null
          included_hours_snapshot: number | null
          is_billable: boolean | null
          rollover_enabled_snapshot: boolean | null
          rounded_minutes: number | null
          rounding_increment_minutes: number | null
          started_at: string | null
          updated_at: string | null
          void_reason: string | null
          voided_at: string | null
          work_date: string | null
        }
        Insert: {
          actual_minutes?: number | null
          billing_agreement_id?: string | null
          billing_cycle_day_snapshot?: number | null
          created_at?: string | null
          customer_id?: string | null
          description?: string | null
          ended_at?: string | null
          hourly_rate?: number | null
          id?: string | null
          included_hours_snapshot?: number | null
          is_billable?: boolean | null
          rollover_enabled_snapshot?: boolean | null
          rounded_minutes?: number | null
          rounding_increment_minutes?: number | null
          started_at?: string | null
          updated_at?: string | null
          void_reason?: string | null
          voided_at?: string | null
          work_date?: string | null
        }
        Update: {
          actual_minutes?: number | null
          billing_agreement_id?: string | null
          billing_cycle_day_snapshot?: number | null
          created_at?: string | null
          customer_id?: string | null
          description?: string | null
          ended_at?: string | null
          hourly_rate?: number | null
          id?: string | null
          included_hours_snapshot?: number | null
          is_billable?: boolean | null
          rollover_enabled_snapshot?: boolean | null
          rounded_minutes?: number | null
          rounding_increment_minutes?: number | null
          started_at?: string | null
          updated_at?: string | null
          void_reason?: string | null
          voided_at?: string | null
          work_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_agreement_customer_fk"
            columns: ["billing_agreement_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customer_billing_agreements"
            referencedColumns: ["id", "customer_id"]
          },
          {
            foreignKeyName: "time_entries_customer_fk"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      cancel_time_timer: { Args: { p_timer_id: string }; Returns: boolean }
      change_customer_billing_terms: {
        Args: {
          p_bill_in_advance: boolean
          p_billing_cycle_day: number
          p_effective_date: string
          p_end_date?: string
          p_included_hours: number
          p_monthly_fee: number
          p_overage_hourly_rate: number
          p_predecessor_id: string
          p_rollover_enabled: boolean
          p_rounding_increment_minutes: number
        }
        Returns: {
          bill_in_advance: boolean
          billing_cycle_day: number
          created_at: string
          customer_id: string
          effective_date: string
          end_date: string | null
          id: string
          included_hours: number
          is_active: boolean
          monthly_fee: number
          overage_hourly_rate: number
          rollover_enabled: boolean
          rounding_increment_minutes: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "customer_billing_agreements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_retainer_period_usage: {
        Args: { p_billing_agreement_id: string; p_reference_date: string }
        Returns: {
          allocations: Json
          billing_agreement_id: string
          customer_id: string
          included_minutes_available: number
          included_minutes_used: number
          overage_amount: number
          overage_minutes: number
          period_end: string
          period_start: string
          remaining_included_minutes: number
          rounded_minutes_used: number
        }[]
      }
      stop_time_timer: {
        Args: { p_hourly_rate?: number; p_timer_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
