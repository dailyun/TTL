import type { ExecutionState } from "../execution/types.js";
import { z } from "zod";

export const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const goalTreeLinkSchema = z.object({ treeId: idSchema, nodeId: idSchema }).strict();
export const checkInInputSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(1000),
  dueAt: z.string().datetime({ offset: true }),
  itemId: idSchema.optional(),
  occurrenceId: idSchema.optional(),
  goalTreeLink: goalTreeLinkSchema.optional()
}).strict();
export const feedbackInputSchema = z.object({
  id: idSchema,
  outcome: z.enum(["completed", "partial", "not_done", "skipped"]),
  text: z.string().trim().max(5000).default(""),
  supersedesId: idSchema.optional()
}).strict();
export const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4096).refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && !url.hash && ["web.push.apple.com", "fcm.googleapis.com", "updates.push.services.mozilla.com"].includes(url.hostname);
  }, "Unsupported push service endpoint"),
  expirationTime: z.number().nonnegative().nullable().optional(),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).refine((s) => Buffer.from(s, "base64url").length === 65),
    auth: z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).refine((s) => Buffer.from(s, "base64url").length === 16)
  }).strict()
}).strict();

export type CheckInInput = z.infer<typeof checkInInputSchema>;
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
export interface CheckIn extends CheckInInput {
  version: number;
  status: "pending" | "answered" | "cancelled";
  createdAt: string;
  updatedAt: string;
  test: boolean;
  targetSubscriptionId?: string;
  kind?: "occurrence" | "morning" | "evening";
  suppressPush?: boolean;
  expiresAt?: string;
  snoozedUntil?: string;
  feedback?: Feedback;
}
export interface Feedback extends FeedbackInput {
  sequence: number;
  checkInId: string;
  submittedAt: string;
  source: "owner_web";
  title: string;
  test: boolean;
  goalTreeLink?: z.infer<typeof goalTreeLinkSchema>;
  itemId?: string;
  occurrenceId?: string;
}
export interface Device {
  id: string;
  subscription: Subscription;
  createdAt: string;
}
export interface Delivery {
  id: string;
  checkInId: string;
  checkInVersion: number;
  subscriptionId: string;
  status: "sending" | "accepted" | "failed" | "unknown";
  attemptedAt: string;
  attempts: number;
  retryAt?: string;
  statusCode?: number;
}
export interface CheckInState {
  workspace?: ExecutionState;
  version: 1;
  sequence: number;
  lastDispatchAt?: string;
  checkIns: CheckIn[];
  devices: Device[];
  deliveries: Delivery[];
  feedback: Feedback[];
}
