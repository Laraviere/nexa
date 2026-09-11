export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      invoice_edit_requests: {
        Row: {
          created_at: string
          invoice_id: string
          payload: Json
          previous_invoice: Json
          previous_items: Json
          request_id: string
        }
        Insert: {
          created_at?: string
          invoice_id: string
          payload: Json
          previous_invoice: Json
          previous_items: Json
          request_id: string
        }
        Update: {
          created_at?: string
          invoice_id?: string
          payload?: Json
          previous_invoice?: Json
          previous_items?: Json
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_edit_requests_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_payment_summary"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_edit_requests_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_totals"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_edit_requests_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_generation_requests: {
        Row: {
          as_of_date: string
          created_at: string
          customer_id: string
          invoice_id: string | null
          request_id: string
          request_payload: Json
        }
        Insert: {
          as_of_date: string
          created_at?: string
          customer_id: string
          invoice_id?: string | null
          request_id: string
          request_payload: Json
        }
        Update: {
          as_of_date?: string
          created_at?: string
          customer_id?: string
          invoice_id?: string | null
          request_id?: string
          request_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "invoice_generation_requests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_generation_requests_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "invoice_payment_summary"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_generation_requests_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "invoice_totals"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_generation_requests_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          amount: number
          billed_minutes: number | null
          billing_agreement_id: string | null
          created_at: string
          description: string
          id: string
          invoice_id: string
          period_end: string | null
          period_start: string | null
          position: number
          quantity: number
          released_at: string | null
          source_type: string
          superseded_at: string | null
          tax_amount: number
          unit: string
          unit_rate: number
          updated_at: string
        }
        Insert: {
          amount?: number
          billed_minutes?: number | null
          billing_agreement_id?: string | null
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          period_end?: string | null
          period_start?: string | null
          position: number
          quantity: number
          released_at?: string | null
          source_type?: string
          superseded_at?: string | null
          tax_amount?: number
          unit: string
          unit_rate: number
          updated_at?: string
        }
        Update: {
          amount?: number
          billed_minutes?: number | null
          billing_agreement_id?: string | null
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          period_end?: string | null
          period_start?: string | null
          position?: number
          quantity?: number
          released_at?: string | null
          source_type?: string
          superseded_at?: string | null
          tax_amount?: number
          unit?: string
          unit_rate?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_billing_agreement_id_fkey"
            columns: ["billing_agreement_id"]
            isOneToOne: false
            referencedRelation: "customer_billing_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_payment_summary"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_totals"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          invoice_id: string
          notes: string | null
          payment_date: string
          payment_method: string
          reference: string | null
          request_id: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          invoice_id: string
          notes?: string | null
          payment_date?: string
          payment_method: string
          reference?: string | null
          request_id: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          invoice_id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string
          reference?: string | null
          request_id?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_payment_summary"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_totals"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_time_allocations: {
        Row: {
          allocated_minutes: number
          created_at: string
          id: string
          invoice_item_id: string
          minute_end: number
          minute_start: number
          released_at: string | null
          time_entry_id: string
        }
        Insert: {
          allocated_minutes?: number
          created_at?: string
          id?: string
          invoice_item_id: string
          minute_end: number
          minute_start: number
          released_at?: string | null
          time_entry_id: string
        }
        Update: {
          allocated_minutes?: number
          created_at?: string
          id?: string
          invoice_item_id?: string
          minute_end?: number
          minute_start?: number
          released_at?: string | null
          time_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_time_allocations_invoice_item_id_fkey"
            columns: ["invoice_item_id"]
            isOneToOne: false
            referencedRelation: "invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_time_allocations_time_entry_id_fkey"
            columns: ["time_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_time_allocations_time_entry_id_fkey"
            columns: ["time_entry_id"]
            isOneToOne: false
            referencedRelation: "unbilled_time_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          billing_address_line1_snapshot: string | null
          billing_address_line2_snapshot: string | null
          billing_city_snapshot: string | null
          billing_country_snapshot: string | null
          billing_postal_code_snapshot: string | null
          billing_state_snapshot: string | null
          company_name_snapshot: string
          created_at: string
          creation_request_id: string | null
          creation_request_payload: Json | null
          customer_id: string
          due_date: string
          email_snapshot: string | null
          id: string
          invoice_number: number
          issue_date: string
          notes: string | null
          payment_terms_days_snapshot: number
          phone_snapshot: string | null
          primary_contact_name_snapshot: string | null
          sent_at: string | null
          status: string
          terms: string | null
          updated_at: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          billing_address_line1_snapshot?: string | null
          billing_address_line2_snapshot?: string | null
          billing_city_snapshot?: string | null
          billing_country_snapshot?: string | null
          billing_postal_code_snapshot?: string | null
          billing_state_snapshot?: string | null
          company_name_snapshot: string
          created_at?: string
          creation_request_id?: string | null
          creation_request_payload?: Json | null
          customer_id: string
          due_date: string
          email_snapshot?: string | null
          id?: string
          invoice_number?: never
          issue_date?: string
          notes?: string | null
          payment_terms_days_snapshot: number
          phone_snapshot?: string | null
          primary_contact_name_snapshot?: string | null
          sent_at?: string | null
          status?: string
          terms?: string | null
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          billing_address_line1_snapshot?: string | null
          billing_address_line2_snapshot?: string | null
          billing_city_snapshot?: string | null
          billing_country_snapshot?: string | null
          billing_postal_code_snapshot?: string | null
          billing_state_snapshot?: string | null
          company_name_snapshot?: string
          created_at?: string
          creation_request_id?: string | null
          creation_request_payload?: Json | null
          customer_id?: string
          due_date?: string
          email_snapshot?: string | null
          id?: string
          invoice_number?: never
          issue_date?: string
          notes?: string | null
          payment_terms_days_snapshot?: number
          phone_snapshot?: string | null
          primary_contact_name_snapshot?: string | null
          sent_at?: string | null
          status?: string
          terms?: string | null
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_settings: {
        Row: {
          card_enabled: boolean
          cash_enabled: boolean
          check_enabled: boolean
          checks_payable_to: string | null
          created_at: string
          singleton: boolean
          updated_at: string
        }
        Insert: {
          card_enabled?: boolean
          cash_enabled?: boolean
          check_enabled?: boolean
          checks_payable_to?: string | null
          created_at?: string
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          card_enabled?: boolean
          cash_enabled?: boolean
          check_enabled?: boolean
          checks_payable_to?: string | null
          created_at?: string
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      quote_write_requests: {
        Row: {
          created_at: string
          payload: Json
          quote_id: string
          request_id: string
        }
        Insert: {
          created_at?: string
          payload: Json
          quote_id: string
          request_id: string
        }
        Update: {
          created_at?: string
          payload?: Json
          quote_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_write_requests_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          company_name_snapshot: string
          conversion_request_id: string
          converted_invoice_id: string | null
          created_at: string
          customer_id: string
          customer_snapshot: Json
          expiration_date: string | null
          id: string
          items: Json
          notes: string | null
          quote_date: string
          quote_number: number
          revision: number
          status: string
          subtotal: number | null
          terms: string | null
          total: number | null
          updated_at: string
        }
        Insert: {
          company_name_snapshot: string
          conversion_request_id?: string
          converted_invoice_id?: string | null
          created_at?: string
          customer_id: string
          customer_snapshot: Json
          expiration_date?: string | null
          id?: string
          items: Json
          notes?: string | null
          quote_date: string
          quote_number?: never
          revision?: number
          status?: string
          subtotal?: number | null
          terms?: string | null
          total?: number | null
          updated_at?: string
        }
        Update: {
          company_name_snapshot?: string
          conversion_request_id?: string
          converted_invoice_id?: string | null
          created_at?: string
          customer_id?: string
          customer_snapshot?: Json
          expiration_date?: string | null
          id?: string
          items?: Json
          notes?: string | null
          quote_date?: string
          quote_number?: never
          revision?: number
          status?: string
          subtotal?: number | null
          terms?: string | null
          total?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotes_converted_invoice_id_fkey"
            columns: ["converted_invoice_id"]
            isOneToOne: true
            referencedRelation: "invoice_payment_summary"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "quotes_converted_invoice_id_fkey"
            columns: ["converted_invoice_id"]
            isOneToOne: true
            referencedRelation: "invoice_totals"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "quotes_converted_invoice_id_fkey"
            columns: ["converted_invoice_id"]
            isOneToOne: true
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
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
      invoice_payment_summary: {
        Row: {
          amount_paid: number | null
          balance_due: number | null
          invoice_id: string | null
          invoice_status: string | null
          invoice_total: number | null
          latest_payment_date: string | null
          payment_count: number | null
          payment_status: string | null
        }
        Relationships: []
      }
      invoice_totals: {
        Row: {
          invoice_id: string | null
          subtotal: number | null
          tax_amount: number | null
          total: number | null
        }
        Relationships: []
      }
      unbilled_time_entries: {
        Row: {
          actual_minutes: number | null
          billing_agreement_id: string | null
          billing_cycle_day_snapshot: number | null
          billing_status: string | null
          blocked_minutes: number | null
          chargeable_minutes: number | null
          covered_minutes: number | null
          created_at: string | null
          customer_id: string | null
          deferred_minutes: number | null
          description: string | null
          ended_at: string | null
          hourly_rate: number | null
          id: string | null
          included_hours_snapshot: number | null
          invoiced_minutes: number | null
          is_billable: boolean | null
          rollover_enabled_snapshot: boolean | null
          rounded_minutes: number | null
          rounding_increment_minutes: number | null
          started_at: string | null
          uninvoiced_minutes: number | null
          updated_at: string | null
          void_reason: string | null
          voided_at: string | null
          work_date: string | null
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
      change_quote_status: {
        Args: { p_quote_id: string; p_revision: number; p_status: string }
        Returns: string
      }
      convert_quote_to_invoice: {
        Args: { p_issue_date: string; p_quote_id: string; p_revision: number }
        Returns: string
      }
      create_composed_invoice: {
        Args: {
          p_as_of_date: string
          p_custom_items: Json
          p_customer_id: string
          p_issue_date: string
          p_notes?: string
          p_request_id: string
          p_revision: string
          p_selected_candidate_ids: string[]
          p_terms?: string
        }
        Returns: {
          as_of_date: string
          company_name_snapshot: string
          due_date: string
          invoice_id: string
          invoice_number: number
          issue_date: string
          status: string
          subtotal: number
          tax_total: number
          total: number
        }[]
      }
      create_manual_invoice: {
        Args: {
          p_customer_id: string
          p_issue_date: string
          p_items: Json
          p_notes?: string
          p_request_id: string
          p_terms?: string
        }
        Returns: {
          company_name_snapshot: string
          due_date: string
          invoice_id: string
          invoice_number: number
          issue_date: string
          status: string
          subtotal: number
          tax_total: number
          total: number
        }[]
      }
      generate_customer_invoice: {
        Args: {
          p_as_of_date?: string
          p_customer_id: string
          p_issue_date: string
          p_notes?: string
          p_request_id: string
          p_terms?: string
        }
        Returns: {
          as_of_date: string
          due_date: string
          invoice_id: string
          invoice_number: number
          issue_date: string
          outcome: string
          status: string
          subtotal: number
          tax_total: number
          total: number
        }[]
      }
      get_invoice_report: {
        Args: {
          p_as_of_date?: string
          p_customer_id?: string
          p_issue_date_from?: string
          p_issue_date_to?: string
          p_overdue_only?: boolean
          p_page?: number
          p_page_size?: number
          p_payment_status?: string
          p_search?: string
          p_sort?: string
          p_workflow_status?: string
        }
        Returns: {
          amount_paid: number
          invoice_count: number
          outstanding_balance: number
          page: number
          page_size: number
          resolved_as_of_date: string
          rows: Json
          total_invoiced: number
          total_pages: number
          total_rows: number
        }[]
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
      get_time_entry_invoiceability: {
        Args: { p_as_of_date: string; p_time_entry_id: string }
        Returns: {
          available_ranges: unknown
          billing_status: string
          blocked_minutes: number
          chargeable_minutes: number
          covered_minutes: number
          deferred_minutes: number
          invoiced_minutes: number
          uninvoiced_minutes: number
        }[]
      }
      invoice_candidate_plan: {
        Args: { p_as_of_date: string; p_customer_id: string }
        Returns: Json
      }
      invoice_edit_preview_state: {
        Args: { p_as_of_date: string; p_invoice_id: string }
        Returns: Json
      }
      invoice_preview_state: {
        Args: { p_as_of_date: string; p_customer_id: string }
        Returns: Json
      }
      normalize_quote_items: { Args: { p_items: Json }; Returns: Json }
      preview_customer_invoice: {
        Args: { p_as_of_date?: string; p_customer_id: string }
        Returns: {
          as_of_date: string
          candidates: Json
          revision: string
        }[]
      }
      preview_invoice_edit: {
        Args: { p_as_of_date: string; p_invoice_id: string }
        Returns: {
          as_of_date: string
          candidates: Json
          revision: string
        }[]
      }
      quote_items_total: { Args: { p_items: Json }; Returns: number }
      record_invoice_payment: {
        Args: {
          p_amount: number
          p_invoice_id: string
          p_notes?: string
          p_payment_date: string
          p_payment_method: string
          p_reference?: string
          p_request_id: string
        }
        Returns: {
          amount_paid: number
          balance_due: number
          invoice_id: string
          invoice_total: number
          latest_payment_date: string
          payment_count: number
          payment_id: string
          payment_status: string
          payment_voided_at: string
        }[]
      }
      save_quote: {
        Args: {
          p_customer_id: string
          p_expiration_date?: string
          p_items: Json
          p_notes?: string
          p_quote_date: string
          p_quote_id?: string
          p_request_id: string
          p_revision?: number
          p_terms?: string
        }
        Returns: string
      }
      stop_time_timer: {
        Args: { p_hourly_rate?: number; p_timer_id: string }
        Returns: Json
      }
      update_checks_payable_to: {
        Args: { p_checks_payable_to: string }
        Returns: {
          card_enabled: boolean
          cash_enabled: boolean
          check_enabled: boolean
          checks_payable_to: string | null
          created_at: string
          singleton: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_composed_invoice: {
        Args: {
          p_as_of_date: string
          p_custom_items: Json
          p_descriptions?: Json
          p_invoice_id: string
          p_issue_date: string
          p_notes?: string
          p_request_id: string
          p_revision: string
          p_selected_candidate_ids: string[]
          p_terms?: string
        }
        Returns: {
          due_date: string
          invoice_id: string
          invoice_number: number
          issue_date: string
          status: string
          subtotal: number
          tax_total: number
          total: number
        }[]
      }
      update_payment_settings: {
        Args: {
          p_card_enabled: boolean
          p_cash_enabled: boolean
          p_check_enabled: boolean
        }
        Returns: {
          card_enabled: boolean
          cash_enabled: boolean
          check_enabled: boolean
          checks_payable_to: string | null
          created_at: string
          singleton: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_invoice_payment: {
        Args: { p_payment_id: string; p_reason: string }
        Returns: {
          amount: number
          created_at: string
          id: string
          invoice_id: string
          notes: string | null
          payment_date: string
          payment_method: string
          reference: string | null
          request_id: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "invoice_payments"
          isOneToOne: true
          isSetofReturn: false
        }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
