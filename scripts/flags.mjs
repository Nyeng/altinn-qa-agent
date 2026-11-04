// Feature-flagg i en PR i altinn-auth. Flaggene opprettes avslått i alle miljøer og slås på for hånd i Azure App
// Configuration (Terraform ignorerer `enabled`), så koden sier aldri når de er på. Derfor:
//   - frontend-flagg (AccessManagementUI.*) gjelder UI-et og testes ikke av API-agenten
//   - backend-flagg får en avkrysningsboks i issuen, og testen starter når den er krysset av

const FLAG_NAME =
  /"((?:AccessManagementUI|AccessManagement|Authorization|ResourceRegistry|Register|Authentication)(?:\.[A-Za-z0-9_]+)+)"/g;

/** Flaggnavn i linjene en diff legger til. */
export function flagsInDiff(diff) {
  const names = new Set();
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const m of line.matchAll(FLAG_NAME)) names.add(m[1]);
  }
  return [...names];
}

export const isFrontendFlag = (name) => name.startsWith("AccessManagementUI.");

export const flagCheckbox = (flags, env) =>
  `- [ ] Flagget ${flags.map((f) => `\`${f}\``).join(", ")} er på i ${env} (kryss av, så starter testen)`;

/** Er avkrysningsboksen for flagget krysset av i issueteksten? Ingen boks = ikke bak flagg. */
export function flagEnabled(body) {
  const box = body.match(/^- \[( |x|X)\] Flagget .* er på i /m);
  return box ? box[1] !== " " : undefined;
}
