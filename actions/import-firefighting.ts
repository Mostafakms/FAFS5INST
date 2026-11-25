import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";

const TYPES = ["Water Spray", "FM-200", "CO2"] as const;

export default defineAction({
  description:
    "Bulk-fill firefighting types and location comments from the project lists. Only fills buildings that have no notes yet. Site Manager only.",
  schema: z.object({
    items: z
      .array(
        z.object({
          buildingId: z.string().min(1),
          types: z.array(z.enum(TYPES)).min(1).max(3),
          comment: z.string().max(2000),
        }),
      )
      .max(200),
  }),
  requiresAuth: true,
  run: async ({ items }) => {
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
      fail("Only the Site Manager can import firefighting details", {
        statusCode: 403,
      });
    let filled = 0;
    const skipped: string[] = [];
    for (const item of items) {
      const [building] = await db
        .select({ notes: schema.buildings.notes })
        .from(schema.buildings)
        .where(eq(schema.buildings.id, item.buildingId))
        .limit(1);
      if (!building || (building.notes ?? "").trim()) {
        skipped.push(item.buildingId);
        continue;
      }
      const types = TYPES.filter((type) => item.types.includes(type));
      await db
        .update(schema.buildings)
        .set({
          notes: JSON.stringify({
            firefighting: { types, comment: item.comment.trim() },
          }),
        })
        .where(eq(schema.buildings.id, item.buildingId));
      filled += 1;
    }
    return { ok: true, filled, skipped };
  },
});
