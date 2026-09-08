import { getDatabase } from "./client";
import { migrate } from "./migrations";
const db = getDatabase();
try {
  await migrate(db);
  console.log("PostgreSQL migrations applied.");
} finally {
  await db.close();
}
