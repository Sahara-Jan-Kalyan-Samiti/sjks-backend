import org from "./org.json" with { type: "json" };

export interface OrgConfig {
  name: string;
  address: string;
  email: string;
  phone: string;
  pan: string;
  receiptPrefix: string;
  signatory: string;
  taxReceipt: { enabled: boolean; type: "80G" | "501c3"; registrationNo: string; validity: string; section12A: string; ein: string; cashLimit: number };
  defaultRequestMessage: string;
}

/** Organisation identity and tax-receipt settings (edit src/config/org.json). */
export const orgConfig = org as OrgConfig;
