/**
 * Set an existing account's role.
 *
 *   npm run role:set -- you@example.com MUNICIPAL
 *   npm run role:set -- you@example.com ADMIN
 *   npm run role:set -- you@example.com USER
 *
 * WHY A SCRIPT RATHER THAN A SIGN-UP OPTION
 * If "make me an administrator" were a checkbox on the registration form,
 * anyone could tick it. Elevated roles are granted from the machine that owns
 * the database, which is the only place that can prove it is the project team.
 *
 * THE THREE ROLES
 *   USER       Commuter portal. Their own journeys, recommendations and rewards.
 *   ADMIN      Admin Portal. City-level demand, optimisation and reporting.
 *   MUNICIPAL  Municipal Dashboard. Road issues, workforce and repairs — and
 *              deliberately NO access to any commuter's data.
 *
 * The account must already exist — sign up normally first, then run this.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ROLES = ["USER", "ADMIN", "MUNICIPAL"];

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const role = process.argv[3]?.trim().toUpperCase();

  if (!email || !role) {
    console.error(
      "\nUsage:  npm run role:set -- you@example.com MUNICIPAL\n" +
        `Roles:  ${ROLES.join(", ")}\n`
    );
    process.exit(1);
  }

  if (!ROLES.includes(role)) {
    console.error(`\n"${role}" is not a role. Choose one of: ${ROLES.join(", ")}\n`);
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, cityflowId: true, role: true, cityCode: true },
  });

  if (!user) {
    console.error(
      `\nNo account found for "${email}".\n` +
        `Sign up on the website first, then run this again.\n`
    );
    process.exit(1);
  }

  if (user.role === role) {
    console.log(`\n"${email}" is already ${role} (${user.cityflowId}).\n`);
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { role } });

  const portal =
    role === "ADMIN"
      ? "/admin"
      : role === "MUNICIPAL"
        ? "/municipal"
        : "/dashboard";

  console.log(
    `\n✔ "${email}" (${user.cityflowId}) is now ${role}.\n\n` +
      `IMPORTANT: sign out and sign in again before opening ${portal}.\n` +
      `The login cookie still says "${user.role}" until a new one is issued.\n`
  );

  if (role === "MUNICIPAL" && !user.cityCode) {
    console.log(
      "NOTE: this account has no city set. The Municipal Dashboard is scoped to\n" +
        "one city, so choose one from the city selector after signing in.\n"
    );
  }
}

main()
  .catch((error) => {
    console.error("\nCould not update the account:\n", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
