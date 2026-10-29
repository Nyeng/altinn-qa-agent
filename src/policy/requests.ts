// Sikkerhetsregler for hver HTTP-forespørsel. Håndheves i koden, ikke i prompten:
//  - URL-en må ligge under API-ets vert og i et Altinn-testmiljø (sjekkes på normalisert URL)
//  - DELETE er kun lov for opprydding av egne `snoken-*`-ressurser (med mindre allowDelete)
//  - PUT/PATCH er kun lov mot data opprettet med POST i samme økt (aldri eksisterende/delte testdata)
import { assertAllowedHost } from "./environments.js";

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Method = (typeof METHODS)[number];

/** Bygger URL-en relativt til API-ets base-URL. Base-URL-en kan selv ha en sti (f.eks. /accessmanagement/api/v1). */
export function resolveUrl(baseUrl: URL, path: string): URL {
  const base = baseUrl.href.endsWith("/") ? baseUrl.href : `${baseUrl.href}/`;
  return new URL(path.replace(/^\/+/, ""), base);
}

/** Returnerer en feilmelding til modellen hvis forespørselen ikke er lov, ellers undefined. */
export function checkRequest(opts: {
  method: Method;
  url: URL;
  baseUrl: URL;
  allowDelete: boolean;
  owned: OwnedData;
}): string | undefined {
  const { method, url, baseUrl, allowDelete, owned } = opts;
  if (url.host !== baseUrl.host) return `Avvist: ${url.host} er utenfor tillatt vert.`;
  try {
    assertAllowedHost(url);
  } catch (err) {
    return (err as Error).message;
  }

  const lastSegment = url.pathname.split("/").filter(Boolean).pop() ?? "";
  if (method === "DELETE" && !allowDelete && !/^snoken-[a-z0-9_-]+$/.test(lastSegment)) {
    return "DELETE er kun lov for opprydding av egne testressurser (identifikator som starter med snoken-).";
  }
  if ((method === "PUT" || method === "PATCH") && !owned.isTargetedBy(url)) {
    return (
      `${method} er bare lov mot testdata du har opprettet med POST i denne økten ` +
      `(kjente: ${owned.list().join(", ") || "ingen ennå"}). Opprett egne testdata først.`
    );
  }
  return undefined;
}

const ID_KEY = /^(id|identifier|uuid|[a-z]*(Id|Uuid))$/;

/** Id-er til data opprettet med POST i økten. PUT/PATCH må treffe en av dem. */
export class OwnedData {
  private readonly ids = new Set<string>();

  /** Registrer id-er fra en vellykket POST: Location-header og id-felt i forespørsel og svar. */
  rememberCreated(requestBody: string | undefined, responseText: string, location: string | null): void {
    const add = (v: unknown) => {
      if ((typeof v === "string" || typeof v === "number") && String(v).length >= 3) this.ids.add(String(v));
    };
    const collect = (obj: unknown) => {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
      for (const [k, v] of Object.entries(obj)) if (ID_KEY.test(k)) add(v);
      const data = (obj as Record<string, unknown>).data;
      if (data && typeof data === "object" && !Array.isArray(data)) collect(data);
    };
    for (const text of [requestBody, responseText]) {
      try {
        collect(JSON.parse(text ?? ""));
      } catch {
        // ikke JSON
      }
    }
    if (location) {
      add(decodeURIComponent(new URL(location, "https://x").pathname.split("/").filter(Boolean).pop() ?? ""));
    }
  }

  /** Treffer URL-en (stisegmenter eller query-verdier) noe opprettet i økten? */
  isTargetedBy(url: URL): boolean {
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    return [...segments, ...url.searchParams.values()].some((v) => this.ids.has(v));
  }

  list(): string[] {
    return [...this.ids];
  }
}
