import { z } from "zod";

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(8000),
});

const conversationStateSchema = z.object({
  currentIntent: z.string().max(80).optional(),
  application: z.string().max(500).optional(),
  manufacturer: z.string().max(120).optional(),
  model: z.string().max(120).optional(),
  partNumber: z.string().max(120).optional(),
  quantity: z.number().positive().max(1_000_000).optional(),
  deliveryLocation: z.string().max(250).optional(),
  requiredDate: z.string().max(80).optional(),
  requiredSpecifications: z
    .record(z.string().max(120), z.string().max(500))
    .optional(),
  productsConsidered: z.array(z.string().max(80)).max(10).optional(),
  missingRequirements: z.array(z.string().max(160)).max(12).optional(),
  lastSummary: z.string().max(2000).optional(),
  version: z.number().int().nonnegative().max(1_000_000).optional(),
});

export const chatRequestSchema = z.object({
  sessionId: z
    .string()
    .trim()
    .min(8)
    .max(128)
    .regex(/^[a-zA-Z0-9._:-]+$/),
  requestId: z
    .string()
    .trim()
    .min(8)
    .max(128)
    .regex(/^[a-zA-Z0-9._:-]+$/),
  message: z.string().trim().min(1).max(20_000),
  recentMessages: z.array(chatMessageSchema).max(8).optional(),
  conversationState: conversationStateSchema.optional(),
  attachmentIds: z.array(z.string().trim().min(1).max(128)).max(5).optional(),
  website: z.string().max(200).optional(),
});
