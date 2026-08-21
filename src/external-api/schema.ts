import { z } from "zod";
import { itemStatusSchema, itemTypeSchema } from "../github-human-files/schema.js";

const itemIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "id may contain letters, numbers, dot, underscore, colon, and dash");
const dateTimeSchema = z.string().datetime({ offset: true });
const titleSchema = z.string().trim().min(1).max(500);
const descriptionSchema = z.string().max(100_000);
const sectionIdSchema = z.string().trim().min(1).max(128);
const tagsSchema = z.array(z.string().trim().min(1).max(80)).max(50);

export const externalItemCreateSchema = z
  .object({
    id: itemIdSchema.optional(),
    type: itemTypeSchema.default("todo"),
    title: titleSchema,
    description: descriptionSchema.default(""),
    sectionId: sectionIdSchema.default("inbox"),
    status: itemStatusSchema.default("wanted"),
    tags: tagsSchema.default([]),
    startAt: dateTimeSchema.optional(),
    endAt: dateTimeSchema.optional(),
    allDay: z.boolean().optional()
  })
  .strict();

export const externalItemPatchSchema = z
  .object({
    type: itemTypeSchema.optional(),
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    sectionId: sectionIdSchema.optional(),
    status: itemStatusSchema.optional(),
    tags: tagsSchema.optional(),
    startAt: dateTimeSchema.nullable().optional(),
    endAt: dateTimeSchema.nullable().optional(),
    allDay: z.boolean().nullable().optional(),
    deletedAt: z.null().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "request body must include at least one editable field"
  });

export const externalItemIdSchema = itemIdSchema;

export const externalItemListQuerySchema = z.object({
  type: itemTypeSchema.optional(),
  status: itemStatusSchema.optional(),
  sectionId: sectionIdSchema.optional(),
  source: z.enum(["local", "github", "google_calendar"]).optional(),
  q: z.string().trim().max(200).optional(),
  updatedSince: dateTimeSchema.optional(),
  includeDeleted: z.enum(["true", "false"]).default("false"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0)
});

export type ExternalItemCreateInput = z.infer<typeof externalItemCreateSchema>;
export type ExternalItemPatchInput = z.infer<typeof externalItemPatchSchema>;
export type ExternalItemListQuery = z.infer<typeof externalItemListQuerySchema>;
