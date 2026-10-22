import type { SupabaseClient } from "@supabase/supabase-js";
import { DuplicateDonationError, type PaymentDonation, type PaymentStore } from "./payments.js";

const COLUMNS = "id,status,amount,donor_name,donor_email,donor_phone,donor_pan,notes";
const UNIQUE_VIOLATION = "23505";

/** PaymentStore backed by Supabase (tables `donations` and `payment_webhook_events`). */
export function createPaymentStore(supabase: SupabaseClient): PaymentStore {
  return {
    async recordEvent(event) {
      const { error } = await supabase.from("payment_webhook_events").insert(event);
      if (!error) return "new";
      if (error.code === UNIQUE_VIOLATION) return "duplicate";
      throw new Error(`Could not store webhook event: ${error.message}`);
    },
    async forgetEvent(eventId) {
      await supabase.from("payment_webhook_events").delete().eq("provider", "razorpay").eq("event_id", eventId);
    },
    async linkEvent(eventId, donationId) {
      await supabase.from("payment_webhook_events").update({ donation_id: donationId }).eq("provider", "razorpay").eq("event_id", eventId);
    },
    async findDonationByPaymentId(paymentId) {
      const { data, error } = await supabase.from("donations").select(COLUMNS).eq("gateway_payment_id", paymentId).maybeSingle();
      if (error) throw new Error(`Could not read donation: ${error.message}`);
      return data as PaymentDonation | null;
    },
    async insertDonation(row) {
      const { data, error } = await supabase.from("donations").insert(row).select(COLUMNS).single();
      if (error?.code === UNIQUE_VIOLATION) throw new DuplicateDonationError(error.message);
      if (error) throw new Error(`Could not save donation: ${error.message}`);
      return data as PaymentDonation;
    },
    async updateDonation(id, patch) {
      const { error } = await supabase.from("donations").update(patch).eq("id", id);
      if (error) throw new Error(`Could not update donation: ${error.message}`);
    }
  };
}
