import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";

const TYPES = ["Water Spray", "FM-200", "CO2"] as const;

export default defineAction({
  description:
    "Seed the individual firefighting units (transformers, rooms) of buildings from the project lists. Each new unit starts with the building's current four firefighting values and weight 1. Buildings that already have units are skipped. Site Manager only.",
  schema: z.object({
    items: z
      .array(
        z.object({
          buildingId: z.string().min(1),
          units: z
            .array(z.object({ type: z.enum(TYPES), name: z.string().min(1).max(200) }))
            .min(1)
            .max(60),
        }),
      )
      .max(120),
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
      fail("Only the Site Manager can seed firefighting units", {
        statusCode: 403,
      });
    const seeded: string[] = [];
    const skipped: string[] = [];
    for (const item of items) {
      const [building] = await db
        .select({ notes: schema.buildings.notes })
        .from(schema.buildings)
        .where(eq(schema.buildings.id, item.buildingId))
        .limit(1);
      let ff: Record<string, unknown> | undefined;
      try {
        ff = building?.notes ? JSON.parse(building.notes).firefighting : undefined;
      } catch {
        ff = undefined;
      }
      if (
        !building ||
        !ff ||
        (Array.isArray(ff.units) && ff.units.length > 0)
      ) {
        skipped.push(item.buildingId);
        continue;
      }
      const base = Array.isArray(ff.progress) ? ff.progress : [0, 0, 0, 0];
      const units = item.units.map((u, i) => ({
        id: `u${i + 1}`,
        type: u.type,
        name: u.name,
        weight: 1,
        progress: [...base],
      }));
      const types = TYPES.filter(
        (t) =>
          (Array.isArray(ff!.types) && (ff!.types as string[]).includes(t)) ||
          units.some((u) => u.type === t),
      );
      await db
        .update(schema.buildings)
        .set({ notes: JSON.stringify({ firefighting: { ...ff, types, units } }) })
        .where(eq(schema.buildings.id, item.buildingId));
      seeded.push(item.buildingId);
    }
    return { ok: true, seeded, skipped };
  },
});
