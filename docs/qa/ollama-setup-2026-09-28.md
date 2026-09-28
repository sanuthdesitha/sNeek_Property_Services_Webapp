# Ollama setup and verification

Base: 51376db0. Date: 2026-09-28.

## User flow

1. Open Admin Settings → System → Ollama.
2. Enter the service address reachable from the web app, e.g. `http://sneek-ollama:11434` on the existing shared Docker network. Save text/vision model names and optional performance settings. The optional gateway key is never returned to the browser; blank preserves it and explicit removal clears it.
3. Run Connection to list installed/loaded models. If needed, explicitly Download model, then select and save its name. Downloading does not change model selections.
4. Run Check all or individual text, assignment and comparison checks. Each result is independent and timestamped; edits invalidate old results. A failed operation remains failed. Synthetic tests exercise local generation and production response schemas; they are not real-property quality benchmarks.
5. Open AI workflow settings to select Ollama and enable assignment/comparison as needed. QA deductions remain proposals for human approval. Dedicated classifier training is separate.

## Implementation and limits

- AppSetting persistence, no new migration; environment defaults remain until settings are saved. Text and vision runtime consumers resolve saved configuration. Shared vision model cannot be silently overridden on the older AI panel.
- Internal addresses only, fixed API paths, no redirects, local model checks, bounded response streams and sanitized diagnostics. Credentials encrypted with the existing server encryption facility. No generic proxy, shell access or Docker socket added.
- Setup operation lease coordinates concurrent app replicas. A worker crash leaves a bounded lease; token-scoped release cannot remove a successor's lease.
- Model pulls stream known progress states/byte counts. Errors, unexpected EOF, oversized progress, cancellation and success are distinct. Download failures may leave Ollama partial files; refresh installed models before retrying.
- CPU performance depends on available server memory/model size. Model loading may still fail. Context and timeout controls apply to real inference, not only diagnostics.
- Existing Ollama service installation, network membership, persistent storage and optional gateway/encryption environment setup remain server prerequisites. The web app cannot provision those infrastructure resources.

## Verification

283 focused tests across 16 suites passed before final review refinements. Final review added two cloud-provider independence checks and two sanitized composer-configuration failure checks; the affected 56-test subset passed. Another 27 existing composer-route/provider-configuration tests passed after updating their mocked persistence boundary (314 distinct tests verified across this work). Responsive browser fixtures passed at 320, 390 and 1440 pixels; screenshot inspected. Tests use mocked provider/API/database boundaries, with real generated PNG fixtures and schema validation. No live model inference/downloads, production DB changes, emails or QA score mutations were performed.

TypeScript `tsc --noEmit` passed after replacing a block-local function declaration incompatible with the repository's ES5 target. The six UI tests passed again after that adjustment. `git diff --check` passed.

Focused advisory coverage (six selected modules, not every touched file):

| File | Lines | Branches | Functions |
|---|---:|---:|---:|
| Ollama settings UI | 100% | 82.30% | 79.16% |
| Operation lease | 100% | 100% | 100% |
| Capability diagnostics | 100% | 95.23% | 100% |
| Settings schema | 100% | 85.18% | 100% |
| Settings store | 100% | 93.75% | 100% |
| Ollama transport | 99.09% | 93.33% | 100% |

Aggregate 99.70% lines, 89.18% branches, 88.88% functions. Several metrics are below the advisory 95% default. There is no required configured coverage gate; this is not a full-suite coverage or regression-baseline verdict.

## API references

Implementation follows Ollama's [chat API](https://docs.ollama.com/api/chat), [model list](https://docs.ollama.com/api/tags), [running models](https://docs.ollama.com/api/ps) and [pull API](https://docs.ollama.com/api/pull). These checks verify capabilities separately rather than treating a model metadata response as successful generation.
