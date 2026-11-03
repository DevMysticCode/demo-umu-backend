import type { OpenAPIObject } from '@nestjs/swagger';
import type { AllowlistEntry } from './website-integration-api-allowlist';

// Carves a subset OpenAPI document out of the full one, keeping only the
// (method, path) pairs in `allowlist`. Used to hand a pen-testing firm
// exactly the surface one frontend (umu-website-integration) actually
// calls — not the other two frontends' endpoints, and not internal/admin
// routes neither of them use. `components` (schemas, the bearer-auth
// scheme) is kept in full rather than trimmed to only-referenced schemas:
// swagger-ui resolves $ref lazily, and an under-trimmed components block
// just means a few unused schema definitions ship, not a broken doc —
// safer than a trimmer that misses a nested $ref and produces 500s on
// "Try it out".
export function buildFilteredDocument(
  full: OpenAPIObject,
  allowlist: AllowlistEntry[],
  title: string,
  description: string,
): OpenAPIObject {
  const allowed = new Set(allowlist.map((e) => `${e.method} ${e.path}`));
  const paths: OpenAPIObject['paths'] = {};

  for (const [path, methods] of Object.entries(full.paths)) {
    const kept: Record<string, unknown> = {};
    for (const [verb, operation] of Object.entries(methods as Record<string, unknown>)) {
      if (allowed.has(`${verb.toUpperCase()} ${path}`)) {
        kept[verb] = operation;
      }
    }
    if (Object.keys(kept).length > 0) {
      paths[path] = kept as (typeof paths)[string];
    }
  }

  return {
    ...full,
    info: { ...full.info, title, description },
    paths,
  };
}
