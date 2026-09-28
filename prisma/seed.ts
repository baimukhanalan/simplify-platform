// `npm run seed` — local demo data. Refuses to touch Postgres unless ALLOW_DEMO_SEED=1.
import { db } from "../src/lib/db";
import { seedDemo } from "../src/lib/demo-seed";

const isProdDb = /postgres/i.test(process.env.DATABASE_URL ?? "");
if (isProdDb && process.env.ALLOW_DEMO_SEED !== "1") throw new Error("Refusing to seed a production database without ALLOW_DEMO_SEED=1");

seedDemo({ staff: !isProdDb || Boolean(process.env.ADMIN_PASSWORD), staffPassword: isProdDb ? process.env.ADMIN_PASSWORD : undefined })
  .then(() => db.$disconnect())
  .catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
