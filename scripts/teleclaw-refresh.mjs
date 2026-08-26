import { fileURLToPath } from "node:url";
import { createService } from "../server/service.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const service = createService({ root });
const days = Number(process.argv[2] || 45);
const stale = await service.staleCatalog(days);

if (!stale.length) {
  console.log(`All crdits catalog entries were verified within ${days} days.`);
} else {
  console.log(`Refresh these crdits catalog entries using official issuer sources first:`);
  for (const card of stale) console.log(`- ${card.name} (${card.slug}) — ${card.verification_status}, last verified ${card.verified_at || "never"}`);
  console.log("Validate every changed source, preserve prior definitions in history, and run `npm run catalog:validate` before reporting completion.");
}
service.db.close();
