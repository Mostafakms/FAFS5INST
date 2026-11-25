import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";

const TYPES = ["Water Spray", "FM-200", "CO2"] as const;

export default defineAction({
  description:
    "Set which firefighting systems a building has (Water Spray, FM-200, CO2) and a comment with the exact location. Site Manager only. Alarm data is not changed.",
  schema: z.object({
    buildingId: z.string().min(1),
    types: z.array(z.enum(TYPES)).max(3),
    comment: z.string().max(2000),
    progress: z.array(z.number().min(0).max(100)).length(4).optional(),
  }),
  requiresAuth: true,
  run: async ({ buildingId, types, comment, progress }) => {
    const email = getRequestUserEmail();
    if (!email) fail("Authentication required", { statusCode: 401 });
    const db = getDb();
    const [user] = await db
      .select({ role: schema.projectUsers.role })
      .from(schema.projectUsers)
      .where(
        and(
          eq(schema.projectUsers.email, email),
          eq(schema.projectUsers.active, true),
        ),
      )
      .limit(1);
    if (!user || user.role !== "Site Manager")
      fail("Only the Site Manager can edit firefighting details", {
        statusCode: 403,
      });
    const [building] = await db
      .select({ notes: schema.buildings.notes })
      .from(schema.buildings)
      .where(eq(schema.buildings.id, buildingId))
      .limit(1);
    if (!building) fail("Building not found", { statusCode: 404 });
    const existing = building.notes ?? "";
    if (existing.trim()) {
      let ok = false;
      try {
        const parsed = JSON.parse(existing);
        ok = parsed && typeof parsed === "object" && "firefighting" in parsed;
      } catch {
        ok = false;
      }
      if (!ok)
        fail("This building already has other notes; not overwriting", {
          statusCode: 409,
        });
    }
    const unique = TYPES.filter((type) => types.includes(type));
    const notes = unique.length
      ? JSON.stringify({
          firefighting: {
            types: unique,
            comment: comment.trim(),
            progress: progress ?? [0, 0, 0, 0],
          },
        })
      : "";
    await db
      .update(schema.buildings)
      .set({ notes })
      .where(eq(schema.buildings.id, buildingId));
    return { ok: true, buildingId, notes };
  },
});
