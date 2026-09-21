# AI provider verification - 2026-09-21

214 focused tests passed across 13 files. Eight synthetic browser cases passed on desktop/mobile, including provider switching, tagged local model saves and QA approval. Final TypeScript validation passed (`tsc --noEmit`, exit 0). All four Compose YAML files parse successfully; Docker execution is unavailable in this environment. No live cloud/local inference, model downloads or Hostinger deployment were performed. No database migration is introduced.

Tests cover provider/key isolation, installed model capabilities, blocked cloud routing, bounded/invalid responses, no paid fallback, historical providerless settings, provider changes invalidating queued cloud analysis, human-only scoring and cleaner evidence scoping. Browser fixtures use actual React controls with mocked APIs, not production data.

Focused coverage: 100% lines, 91.57% branches, 89.36% functions across the measured files below. This is not a full-suite baseline or 95% certification: several metrics fall below the advisory target, and the classic composer button-label-only file is not measured. The repository has no required coverage gate. No new full production build was run for this provider change; the earlier build in the photo-workflows record applies to its earlier commit.

| File | Lines | Branches | Functions |
|---|---:|---:|---:|
| `app/api/admin/ai/vision/route.ts` | 100% | 72.72% | 100% |
| `app/api/admin/marketing/ai-compose/route.ts` | 100% | 96.29% | 100% |
| `app/v2/admin/ai/page.tsx` | 100% | 100% | 100% |
| `components/v2/admin/vision-settings.tsx` | 100% | 85.36% | 58.33% |
| `lib/ai/config.ts` | 100% | 85.71% | 100% |
| `lib/ai/ollama.ts` | 100% | 93.45% | 100% |
| `lib/ai/openai-vision.ts` | 100% | 93.75% | 100% |
| `lib/ai/vision-settings-schema.ts` | 100% | 100% | 100% |
| `lib/ai/vision-settings.ts` | 100% | 100% | 100% |
| `lib/ai/vision.ts` | 100% | 97.27% | 100% |
| `lib/cleaner/photo-assignment.ts` | 100% | 87.91% | 100% |
| `lib/marketing/ai-composer.ts` | 100% | 100% | 100% |
