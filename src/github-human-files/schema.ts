import { z } from "zod";

export const itemTypeSchema = z.enum(["todo", "idea", "event", "avoid", "note"]);
export const itemStatusSchema = z.enum(["wanted", "active", "paused", "abandoned", "done"]);

export const humanSourceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  path: z.string().min(1),
  mode: z.enum(["read-only", "read-write"]),
  defaultSectionId: z.string().min(1),
  defaultType: itemTypeSchema,
  defaultStatus: itemStatusSchema,
  importCheckboxes: z.boolean().default(false),
  writeBack: z.enum(["none", "frontmatter-only", "full-file"]).default("frontmatter-only")
});

export const sourcesFileSchema = z.object({
  version: z.literal(1),
  sources: z.array(humanSourceSchema)
});

export const frontmatterSchema = z
  .object({
    id: z.string().optional(),
    type: itemTypeSchema.optional(),
    status: itemStatusSchema.optional(),
    section: z.string().optional(),
    sectionId: z.string().optional(),
    title: z.string().optional(),
    tags: z.array(z.string()).optional(),
    startAt: z.union([z.string(), z.date()]).nullable().optional(),
    endAt: z.union([z.string(), z.date()]).nullable().optional(),
    allDay: z.boolean().optional(),
    updatedAt: z.union([z.string(), z.date()]).nullable().optional(),
    createdAt: z.union([z.string(), z.date()]).nullable().optional()
  })
  .passthrough();

export const frontmatterWritebackPatchSchema = z
  .object({
    id: z.string().optional(),
    type: itemTypeSchema.optional(),
    status: itemStatusSchema.optional(),
    section: z.string().optional(),
    sectionId: z.string().optional(),
    title: z.string().optional(),
    tags: z.array(z.string()).optional(),
    startAt: z.string().nullable().optional(),
    endAt: z.string().nullable().optional(),
    allDay: z.boolean().optional(),
    updatedAt: z.string().optional()
  })
  .strict();

export const writebackRequestSchema = z.object({
  sourcePath: z.string().min(1),
  patch: frontmatterWritebackPatchSchema.refine((value) => Object.keys(value).length > 0, {
    message: "patch must include at least one field"
  }),
  expectedSha: z.string().optional()
});

export const createLocalHumanFileRequestSchema = z.object({
  sourceId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(180),
  type: itemTypeSchema.optional(),
  status: itemStatusSchema.optional(),
  sectionId: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
  description: z.string().max(20000).default(""),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  allDay: z.boolean().optional()
});
