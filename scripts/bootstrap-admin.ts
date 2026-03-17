import bcrypt from "bcryptjs";
import { PrismaClient, Role } from "@prisma/client";

const db = new PrismaClient();

function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : "";
}

async function main() {
  const email = readEnv("BOOTSTRAP_ADMIN_EMAIL").toLowerCase();
  const password = readEnv("BOOTSTRAP_ADMIN_PASSWORD");
  const name = readEnv("BOOTSTRAP_ADMIN_NAME") || "Admin User";

  if (!email || !password) {
    console.log("bootstrap-admin: skipped (BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD not set)");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await db.user.upsert({
    where: { email },
    create: {
      email,
      name,
      role: Role.ADMIN,
      isActive: true,
      passwordHash,
      emailVerified: new Date(),
    },
    update: {
      name,
      role: Role.ADMIN,
      isActive: true,
      passwordHash,
      emailVerified: new Date(),
    },
  });

  console.log(`bootstrap-admin: ensured admin user ${user.email}`);
}

main()
  .catch((error) => {
    console.error("bootstrap-admin: failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
