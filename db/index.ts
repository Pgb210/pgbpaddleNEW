import { getDatabase } from "@netlify/database";
import { drizzle } from "drizzle-orm/netlify-db";
import * as schema from "./schema.js";

function createDatabase() {
  return drizzle({ client: getDatabase(), schema });
}

let database: ReturnType<typeof createDatabase> | undefined;

export function getDb() {
  database ??= createDatabase();
  return database;
}
