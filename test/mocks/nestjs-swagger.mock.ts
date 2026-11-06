// Jest mock for @nestjs/swagger (wired via moduleNameMapper in
// package.json's jest config, test-environment only — never used at
// runtime). @nestjs/swagger's compiled output is pure ESM with no CJS
// fallback, and transitively pulls in swagger-ui-dist's bundled UI
// assets, which Jest can't require() either — confirmed by the actual
// failure: `Must use import to load ES Module:
// .../swagger-ui/index.js`, several layers deep inside
// @nestjs/swagger/dist/index.js. None of that matters for a unit test:
// specs only import a controller to read reflected metadata
// (@Throttle() etc.), and the real decorator implementations attach
// OpenAPI metadata that's irrelevant unless the test is actually
// exercising Swagger itself. No-op stubs matching the exact named
// exports this codebase imports (see `grep -rhoE "from
// '@nestjs/swagger'"` across src/) are enough to let those controller
// files load under Jest without pulling in swagger-ui-dist at all.
// Keep this list in sync — a new @nestjs/swagger import anywhere in
// src/ needs a matching no-op here or its spec fails with "X is not a
// function" (as ApiBearerAuth did until this line was added).
const noopDecorator = () => () => undefined;

export const ApiBody = noopDecorator;
export const ApiConsumes = noopDecorator;
export const ApiProperty = noopDecorator;
export const ApiBearerAuth = noopDecorator;
export const ApiOperation = noopDecorator;
export const ApiResponse = noopDecorator;
export const ApiParam = noopDecorator;
export const ApiQuery = noopDecorator;
export const ApiHeader = noopDecorator;
export const ApiTags = noopDecorator;

export class DocumentBuilder {
  setTitle() { return this; }
  setDescription() { return this; }
  setVersion() { return this; }
  addBearerAuth() { return this; }
  build() { return {}; }
}

export const SwaggerModule = {
  createDocument: () => ({}),
  setup: () => undefined,
};
