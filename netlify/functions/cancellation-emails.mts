import type { Config } from "@netlify/functions";
import { eq, or, sql } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { cancellationNotices } from "../../db/schema.js";
import { deliverCancellationNotice } from "../lib/email.js";

export default async () => {
  const notices = await getDb().select().from(cancellationNotices).where(or(eq(cancellationNotices.customerSent, false), eq(cancellationNotices.adminSent, false))).orderBy(sql`random()`).limit(50);
  const started = Date.now();
  for (const notice of notices) {
    if (Date.now() - started > 35_000) break;
    await deliverCancellationNotice(notice);
  }
};
export const config: Config = { schedule: "*/10 * * * *" };
