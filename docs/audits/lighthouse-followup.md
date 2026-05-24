# Lighthouse — Pending

Lighthouse has its own toolchain (`lighthouse` CLI npm package). It is not
currently installed as a project dependency. Run it manually against the
three reference pages:

```bash
npx lighthouse http://localhost:3000/ \
  --output html \
  --output-path docs/audits/lighthouse-public-home.html \
  --only-categories=performance,accessibility,best-practices

npx lighthouse http://localhost:3000/admin \
  --output html \
  --output-path docs/audits/lighthouse-admin.html \
  --only-categories=performance,accessibility,best-practices

npx lighthouse http://localhost:3000/cleaner \
  --output html \
  --output-path docs/audits/lighthouse-cleaner.html \
  --only-categories=performance,accessibility,best-practices
```

Target thresholds per Foundation spec §16:

- Performance ≥ 90
- Accessibility ≥ 95
- Best practices ≥ 90

Use the mobile preset (default). Capture scores in a follow-up commit
once Plan D (image illustrations) and Plan F email PR have landed —
that's when the public marketing pages will reach their representative
state for measurement.

## Lighthouse CI (optional future)

For automated regression budgets in CI, install `@lhci/cli`:

```bash
npm i -D @lhci/cli
npx lhci autorun --collect.url=http://localhost:3000/ --assert.preset=lighthouse:recommended
```

This is out of scope for the initial fix-loop — listed here so the next
engineer to pick this up knows what tooling to install.
