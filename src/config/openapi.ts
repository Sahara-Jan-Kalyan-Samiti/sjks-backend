/**
 * Hand-written OpenAPI 3 description of the API, shown by Swagger UI at /docs (never in production).
 * Keep it in step with src/routes and src/utils/validators.ts.
 */

const TAGS = ["Health", "Public", "Donations", "Requests", "Broadcast", "Admins", "Webhooks"] as const;
type Tag = (typeof TAGS)[number];

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonContent = (schema: object) => ({ "application/json": { schema } });
const body = (schema: object, required = true) => ({ required, content: jsonContent(schema) });
const idPath = { name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } };
const receiptType = { type: "string", enum: ["tax", "receipt"], description: "'tax' gives the tax-exemption receipt" };

const errorResponse = (description: string) => ({ description, content: jsonContent(ref("Error")) });
const okResponse = { description: "Done", content: jsonContent(ref("Ok")) };
const authErrors = { "401": errorResponse("Missing or invalid token"), "403": errorResponse("Your role is not allowed to do this") };

/** The shape shared by every operation: tag, summary and an optional login requirement. */
const operation = (tag: Tag, summary: string, rest: object = {}, secured = false) => ({
  tags: [tag],
  summary,
  ...(secured ? { security: [{ bearerAuth: [] }] } : {}),
  ...rest
});

const paymentProofProperties = {
  order_id: { type: "string", example: "order_Abc123XyZ789", description: "From /donations/order" },
  payment_id: { type: "string", example: "pay_Abc123XyZ789", description: "From Razorpay Checkout" },
  signature: { type: "string", example: "a".repeat(64), description: "HMAC-SHA256 hex that Checkout returns" }
};

const schemas = {
  Error: { type: "object", properties: { error: { type: "string" }, field: { type: "string" } } },
  Ok: { type: "object", properties: { ok: { type: "boolean", example: true } } },
  DocumentRequest: {
    type: "object",
    required: ["request_type", "document_type", "name", "email", "phone", "purpose"],
    properties: {
      request_type: { type: "string", enum: ["Certificate", "Audit report"] },
      document_type: { type: "string", maxLength: 200, example: "80G certificate" },
      financial_year: { type: "string", maxLength: 40, example: "2024-25" },
      delivery: { type: "string", maxLength: 80, default: "PDF by email", description: "Anything other than 'PDF by email' needs delivery_address" },
      delivery_address: { type: "string", maxLength: 400 },
      name: { type: "string", maxLength: 120, example: "Asha Verma" },
      organisation: { type: "string", maxLength: 160 },
      email: { type: "string", format: "email", example: "asha@example.com" },
      phone: { type: "string", example: "9876543210" },
      purpose: { type: "string", maxLength: 120, example: "Tax filing" },
      message: { type: "string", maxLength: 2000 },
      reference: { type: "string", maxLength: 40 },
      website: { type: "string", description: "Spam trap. Leave empty: anything here is silently discarded." }
    }
  },
  Volunteer: {
    type: "object",
    required: ["name", "phone"],
    properties: {
      name: { type: "string", maxLength: 120, example: "Ravi Kumar" },
      phone: { type: "string", example: "+919876543210" },
      email: { type: "string", format: "email" },
      area: { type: "string", maxLength: 80 },
      message: { type: "string", maxLength: 2000 },
      website: { type: "string", description: "Spam trap. Leave empty." }
    }
  },
  DonationOrder: {
    type: "object",
    required: ["amount", "name", "email"],
    properties: {
      amount: { type: "integer", minimum: 1, maximum: 10_000_000, example: 500, description: "Whole rupees" },
      name: { type: "string", maxLength: 80, example: "Asha Verma" },
      email: { type: "string", format: "email", example: "asha@example.com" },
      phone: { type: "string", example: "9876543210" },
      pan: { type: "string", example: "ABCDE1234F", description: "Optional, needed only for the 80G certificate" }
    }
  },
  PaymentProof: { type: "object", required: ["order_id", "payment_id", "signature"], properties: paymentProofProperties },
  SendRequest: {
    type: "object",
    required: ["subject", "message"],
    properties: { subject: { type: "string", maxLength: 200 }, message: { type: "string", maxLength: 5000 } }
  },
  Broadcast: {
    type: "object",
    required: ["audience", "subject", "message"],
    properties: {
      audience: { type: "string", enum: ["volunteers", "donors", "all"] },
      subject: { type: "string", maxLength: 200 },
      message: { type: "string", maxLength: 5000 }
    }
  },
  CreateAdmin: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email" },
      password: { type: "string", minLength: 8, maxLength: 72 },
      display_name: { type: "string", maxLength: 80 }
    }
  }
};

const paths = {
  "/health": { get: operation("Health", "Liveness check", { responses: { "200": { description: "The process is running" } } }) },
  "/ready": {
    get: operation("Health", "Readiness check (also asks the database)", {
      responses: { "200": { description: "Ready" }, "503": { description: "Database unavailable" } }
    })
  },

  "/api/public/events": { get: operation("Public", "Published events", { responses: { "200": { description: "List of events" } } }) },
  "/api/public/projects": { get: operation("Public", "Published projects", { responses: { "200": { description: "List of projects" } } }) },
  "/api/public/document-requests": {
    post: operation("Public", "Website form: request a certificate or audit report", {
      description: "Rate limited per IP (5 per 15 minutes).",
      requestBody: body(ref("DocumentRequest")),
      responses: {
        "200": {
          description: "Stored",
          content: jsonContent({ type: "object", properties: { ok: { type: "boolean" }, reference: { type: "string" } } })
        },
        "400": errorResponse("Validation failed"),
        "429": errorResponse("Too many requests")
      }
    })
  },
  "/api/public/volunteers": {
    post: operation("Public", "Website form: volunteer sign-up (stored as pending)", {
      description: "Rate limited per IP (5 per 15 minutes).",
      requestBody: body(ref("Volunteer")),
      responses: { "200": okResponse, "400": errorResponse("Validation failed"), "429": errorResponse("Too many requests") }
    })
  },

  "/api/public/donations/order": {
    post: operation("Donations", "Website: start a Razorpay payment", {
      description: "Creates a Razorpay order. Needs RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (test keys are fine). Rate limited per IP.",
      requestBody: body(ref("DonationOrder")),
      responses: {
        "200": {
          description: "What Razorpay Checkout needs",
          content: jsonContent({
            type: "object",
            properties: {
              keyId: { type: "string" },
              orderId: { type: "string" },
              amount: { type: "integer", description: "Paise" },
              currency: { type: "string", example: "INR" }
            }
          })
        },
        "400": errorResponse("Validation failed"),
        "429": errorResponse("Too many requests"),
        "502": errorResponse("Razorpay refused the order"),
        "503": errorResponse("Online payment is not configured")
      }
    })
  },
  "/api/public/donations/verify": {
    post: operation("Donations", "Website: check that a payment confirmation is genuine", {
      requestBody: body(ref("PaymentProof")),
      responses: { "200": okResponse, "400": errorResponse("Invalid or unverifiable payment"), "429": errorResponse("Too many requests") }
    })
  },
  "/api/public/donations/receipt": {
    get: operation("Donations", "Website: the donor's receipt (HTML), given the signed payment proof", {
      parameters: Object.entries(paymentProofProperties).map(([name, schema]) => ({ name, in: "query", required: true, schema })),
      responses: {
        "200": { description: "Receipt page", content: { "text/html": { schema: { type: "string" } } } },
        "400": errorResponse("Invalid or unverifiable payment"),
        "404": errorResponse("Receipt not ready yet"),
        "429": errorResponse("Too many requests")
      }
    })
  },
  "/api/donations/{id}/receipt": {
    get: operation(
      "Donations",
      "Printable HTML receipt (admin, editor)",
      {
        parameters: [idPath, { name: "type", in: "query", schema: receiptType }],
        responses: {
          "200": { description: "Receipt page", content: { "text/html": { schema: { type: "string" } } } },
          "400": errorResponse("Invalid id, or the donation was not successful"),
          "404": errorResponse("Donation not found"),
          ...authErrors
        }
      },
      true
    )
  },
  "/api/donations/{id}/send-receipt": {
    post: operation(
      "Donations",
      "E-mail the receipt to the donor (admin)",
      {
        parameters: [idPath],
        requestBody: body({ type: "object", properties: { type: receiptType } }, false),
        responses: { "200": okResponse, "404": errorResponse("Donation not found"), ...authErrors }
      },
      true
    )
  },
  "/api/exports/donations.csv": {
    get: operation(
      "Donations",
      "Download all donations as CSV (admin)",
      { responses: { "200": { description: "CSV file", content: { "text/csv": { schema: { type: "string" } } } }, ...authErrors } },
      true
    )
  },

  "/api/requests/{id}/default-message": {
    get: operation(
      "Requests",
      "Pre-filled reply for a document request (admin, editor)",
      {
        parameters: [idPath],
        responses: {
          "200": {
            description: "Message",
            content: jsonContent({ type: "object", properties: { message: { type: "string" }, mailReady: { type: "boolean" } } })
          },
          "404": errorResponse("Request not found"),
          ...authErrors
        }
      },
      true
    )
  },
  "/api/requests/{id}/send": {
    post: operation(
      "Requests",
      "E-mail the attached documents to the requester (admin)",
      {
        parameters: [idPath],
        requestBody: body(ref("SendRequest")),
        responses: {
          "200": okResponse,
          "400": errorResponse("Validation failed, or mail is not configured"),
          "404": errorResponse("Request not found"),
          ...authErrors
        }
      },
      true
    )
  },

  "/api/broadcast": {
    get: operation("Broadcast", "Audience sizes and recent broadcasts (admin)", { responses: { "200": { description: "Overview" }, ...authErrors } }, true),
    post: operation(
      "Broadcast",
      "Send an e-mail to volunteers and/or donors (admin)",
      { requestBody: body(ref("Broadcast")), responses: { "200": { description: "Result" }, "400": errorResponse("Validation failed"), ...authErrors } },
      true
    )
  },
  "/api/admins": {
    post: operation(
      "Admins",
      "Create a staff account (admin)",
      { requestBody: body(ref("CreateAdmin")), responses: { "201": { description: "Created" }, "400": errorResponse("Validation failed"), ...authErrors } },
      true
    )
  },

  "/api/webhooks/razorpay": {
    post: operation("Webhooks", "Razorpay webhook (called by Razorpay)", {
      description:
        "x-razorpay-signature must be the HMAC-SHA256 hex of the exact raw body under RAZORPAY_WEBHOOK_SECRET, so a real call cannot be made from Swagger UI. Sending a wrong signature is still a handy way to see the 400.",
      parameters: [
        { name: "x-razorpay-signature", in: "header", required: true, schema: { type: "string" } },
        { name: "x-razorpay-event-id", in: "header", schema: { type: "string" } }
      ],
      requestBody: body({ type: "object", example: { event: "payment.captured", payload: {} } }),
      responses: {
        "200": {
          description: "Processed",
          content: jsonContent({ type: "object", properties: { ok: { type: "boolean" }, outcome: { type: "string" } } })
        },
        "400": errorResponse("Bad signature or JSON"),
        "503": errorResponse("Webhook secret not configured")
      }
    })
  }
};

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "SJKS Backend API",
    version: "1.0.0",
    description:
      "Payments, receipts, e-mail, exports and public website data. To try the protected endpoints click Authorize and paste the access token (JWT) of an active staff member from Supabase."
  },
  tags: TAGS.map((name) => ({ name })),
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Supabase access token of a staff member who is active in admin_profiles."
      }
    },
    schemas
  },
  paths
};
