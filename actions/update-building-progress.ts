import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";

export default defineAction({
  description:
    "Update several activity progress values of one building in one save and record history for each changed value.",
  schema: z.object({
    buildingId: z.string().min(1),
    updates: z
      .array(
        z.object({
          activityId: z.string().min(1),
          progress: z.number().min(0).max(100),
        }),
      )
      .min(1)
      .max(50),
    note: z.string().max(1000).optional(),
  }),
  requiresAuth: true,
  run: async ({ buildingId, updates, note }) => {
    const email = getRequestUserEmail();
    if (!email) fail("Authentication required", { statusCode: 401 });
    const db = getDb();
    return db.transaction(async (tx) => {
      const [user] = await tx.select().from(schema.projectUsers).where(and(eq(schema.projectUsers.email, email), eq(schema.projectUsers.active, true))).limit(1);
      if (!user || (user.role !== "Site Manager" && user.role !== "Supervisor")) {
        fail("You do not have permission to update progress", { statusCode: 403 });
      }
      const [building] = await tx.select().from(schema.buildings).where(eq(schema.buildings.id, buildingId)).limit(1);
      if (!building) fail("Building not found", { statusCode: 404 });
      const now = new Date().toISOString();
      const cleanNote = note?.trim() ?? "";
      let changed = 0;
      for (const { activityId, progress } of updates) {
        const [activity] = await tx.select().from(schema.activities).where(and(eq(schema.activities.id, activityId), eq(schema.activities.active, true))).limit(1);
        if (!activity) fail("Active activity not found", { statusCode: 404 });
        const [previous] = await tx.select().from(schema.activityProgress).where(and(eq(schema.activityProgress.buildingId, buildingId), eq(schema.activityProgress.activityId, activityId))).limit(1);
        const previousProgress = Number(previous?.progress ?? 0);
        if (previous && previousProgress === progress) continue;
        const nextProgress = String(progress);
        await tx.insert(schema.activityProgress).values({
          id: previous?.id ?? crypto.randomUUID(),
          buildingId,
          activityId,
          progress: nextProgress,
          note: cleanNote,
          updatedAt: now,
          updatedBy: user.displayName,
        }).onConflictDoUpdate({
          target: [schema.activityProgress.buildingId, schema.activityProgress.activityId],
          set: { progress: nextProgress, note: cleanNote, updatedAt: now, updatedBy: user.displayName },
        });
        await tx.insert(schema.progressHistory).values({
          id: crypto.randomUUID(),
          buildingId,
          activityId,
          previousProgress: String(previousProgress),
          newProgress: nextProgress,
          note: cleanNote,
          changedAt: now,
          changedBy: user.displayName,
        });
        changed++;
      }
      return { ok: true, changed };
    });
  },
});
