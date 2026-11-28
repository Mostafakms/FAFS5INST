import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";

// The four firefighting activity weights are one project-wide setting. They are
// stored as JSON in a single row (id "firefighting-weights") of the existing
// site_maps table, so no schema migration is needed.
export default defineAction({
  description:
    "Set the weights of the four firefighting activities (Workshop drawings, Installation, Commissioning, As-built) for the whole project. Site Manager only.",
  schema: z.object({
    weights: z.array(z.number().min(0).max(100)).length(4),
  }),
  requiresAuth: true,
  run: async ({ weights }) => {
    const email = getRequestUserEmail();
    if (!email) fail("Authentication required", { statusCode: 401 });
    if (weights.every((w) => w === 0))
      fail("At least one weight must be above 0", { statusCode: 400 });
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
      fail("Only the Site Manager can edit firefighting weights", {
        statusCode: 403,
      });
    const row = {
      id: "firefighting-weights",
      filename: "firefighting-weights.json",
      contentType: "application/json",
      dataBase64: JSON.stringify(weights),
    };
    const [existing] = await db
      .select({ id: schema.siteMaps.id })
      .from(schema.siteMaps)
      .where(eq(schema.siteMaps.id, row.id))
      .limit(1);
    if (existing) {
      await db
        .update(schema.siteMaps)
        .set({ dataBase64: row.dataBase64 })
        .where(eq(schema.siteMaps.id, row.id));
    } else {
      await db.insert(schema.siteMaps).values(row);
    }
    return { ok: true, weights };
  },
});
