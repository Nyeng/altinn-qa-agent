// Felles testhjelpere: konfig uten filsystem/miljø, og en falsk fetch som ruter på URL.
import { Session } from "../src/agent/session.js";
import { loadConfig } from "../src/config.js";

export const SECRETS = {
  register: "register-key-secret",
  authz: "authz-key-secret",
  soap: "soap-password-secret",
  generator: "generator-password",
  token: "eyJ-fake-token-value",
};

export function testConfig(extra: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}) {
  return loadConfig(["--env=at22"], {
    QA_CONFIG_AT22: JSON.stringify({
      BASE_URL: "https://platform.at22.altinn.cloud",
      AM_UI_BASE_URL: "https://am.ui.at22.altinn.cloud",
      REGISTER_SUBSCRIPTION_KEY: SECRETS.register,
      AUTHORIZATION_SUBSCRIPTION_KEY: SECRETS.authz,
      SOAP_ER_PASSWORD: SECRETS.soap,
      ...extra,
    }),
    TOKEN_GENERATOR_USERNAME: "user",
    TOKEN_GENERATOR_PASSWORD: SECRETS.generator,
    ...env,
  });
}

export type SentRequest = { url: URL; method: string; headers: Record<string, string>; body?: string };

/** Falsk fetch: token generator svarer med et token, alt annet går til `handler`. Alle forespørsler logges. */
export function fakeFetch(handler: (req: SentRequest) => Response | Promise<Response>) {
  const sent: SentRequest[] = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const req: SentRequest = {
      url,
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: init.body as string | undefined,
    };
    if (url.hostname.includes("token-generator")) return new Response(SECRETS.token);
    sent.push(req);
    return handler(req);
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function testSession(handler: (req: SentRequest) => Response | Promise<Response> = () => json({})) {
  const { fetch, sent } = fakeFetch(handler);
  const session = new Session(testConfig(), { fetch, random: () => 0 });
  return { session, sent };
}
