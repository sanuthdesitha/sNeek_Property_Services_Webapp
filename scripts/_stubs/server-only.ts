/**
 * No-op stand-in for the `server-only` marker package, used ONLY by CLI scripts.
 *
 * `lib/db.ts` (and other server modules) start with `import "server-only"`. Next
 * special-cases that import at build time to fail the build if server code leaks
 * into a client bundle — a guard we want to keep. But a plain `tsx` script isn't
 * Next: in a pruned production image the module isn't installed at all
 * ("Cannot find module 'server-only'"), and the real npm package deliberately
 * THROWS when imported outside a React Server Component. Either way a maintenance
 * script that legitimately touches the database can't start.
 *
 * tsconfig.scripts.json maps `server-only` here so scripts import a harmless
 * empty module. The app's own tsconfig is untouched, so the build-time guard
 * still works exactly as before.
 */
export {};
