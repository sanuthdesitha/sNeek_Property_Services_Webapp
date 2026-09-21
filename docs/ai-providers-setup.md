# Connect local or cloud AI

The app supports Ollama (local), OpenAI and Anthropic for photo assignment, reference-photo QA proposals and social-post drafting. QA/admin still approves deductions. Cleaner assignments are reviewed before applying them. Selecting Ollama never falls back to OpenAI or Anthropic.

## Local server with Ollama

Deploy the app source as usual. Model **weights** are separate downloads/uploads, not application source files. Ollama serves those weights over a private API. Local inference needs no OpenAI/Anthropic key; hardware, storage and hosting still cost money. Download the runtime and weights before disconnecting internet access. The web app itself still needs its database, photo storage and other configured services.

The starter vision model is `gemma3:4b`: it supports multiple images needed for comparing submissions with references and historical examples. Text-only models cannot analyze photos. Llama models can be used for writing; Llama 3.2 Vision's single-image limitation makes it unsuitable for these multi-image comparisons. Validate quality on reviewed jobs before broader use. [Ollama multimodal documentation](https://ollama.com/blog/multimodal-models).

For the repository's Docker Compose deployment:

1. Set these values in the server's private `.env` (never commit it):

   ```dotenv
   OLLAMA_BASE_URL=http://ollama:11434
   OLLAMA_VISION_MODEL=gemma3:4b
   OLLAMA_TEXT_MODEL=gemma3:4b
   AI_TEXT_PROVIDER=ollama
   ```

2. Start the private model service and download the model:

   ```sh
   docker compose -f docker-compose.yml -f docker-compose.ollama.yml up -d ollama
   docker compose -f docker-compose.yml -f docker-compose.ollama.yml exec ollama ollama pull gemma3:4b
   ```

   The override stores models in a persistent volume and sets `OLLAMA_NO_CLOUD=1`. It does not publish the API port. Keep the service on a trusted private network. The app accepts loopback/private IPs or single-label internal hosts such as `ollama`; public endpoints and cloud model metadata are rejected. A protected internal reverse proxy can use optional `OLLAMA_API_KEY`. [Ollama local-only configuration](https://docs.ollama.com/faq).

3. Rebuild/recreate web and worker containers through your normal deployment procedure with the same two compose files. Both processes need the AI variables. Their existing startup commands also run application initialization; follow your existing deployment/backups procedure.
4. Open **Admin → AI configuration → Photo analysis**, select **Ollama (local server)** and model **gemma3:4b**, save, then **Check provider and saved model**. This checks installed capabilities without sending photos. Enable assignment/comparison when ready, save again, and test with a known property. Existing saved providers do not change automatically when environment variables change.
5. Confirm the **Social post composer** shows `ollama`, then open **Growth > Marketing > Social posts > New draft**, enter a topic and click **Generate with AI**. Review the suggestion and click **Use generated caption** before saving. Generation does not publish or save a post. `AI_TEXT_PROVIDER` independently selects its provider. Run `ollama ps` inside the container to inspect model/processor use.

For NVIDIA acceleration, install NVIDIA Container Toolkit and add `-f docker-compose.ollama-gpu.yml` to the commands. CPU inference may exceed interactive limits: start with small batches, warm the model and benchmark. Inference is bounded to 45 seconds plus an 8-second metadata check; the cleaner's existing client limit is 60 seconds, including other work. RAM/VRAM requirements depend on model, context and image count. Check your actual server capacity. [Official Docker/GPU instructions](https://docs.ollama.com/docker).

For a non-Docker same-machine installation, install Ollama and use `OLLAMA_BASE_URL=http://127.0.0.1:11434` on app and worker. Set `OLLAMA_NO_CLOUD=1` on the **Ollama process**, restart it and pull the model. Inside Docker, localhost means the app container itself; use the compose service name. Pin a validated Ollama image version/digest for production after testing; the starter override uses `latest`.

## Your Hostinger KVM 2 VPS

Your supplied plan shows 2 CPU cores, 8 GB RAM and 100 GB disk. A GPU was not listed. These resources also run the app, database and workers. Treat local text generation as a trial; reliable multi-image vision speed on this shared CPU server has not been established.

Add `-f docker-compose.ollama-small-vps.yml` after the Ollama override in every command. It caps Ollama at one CPU and 4 GB RAM (no extra swap), loads one model at a time and limits its queue. These are starting limits, not a guarantee that the rest of the app has enough free memory. Check `free -h`, `df -h` and `docker stats` before starting. Stop the Ollama service if the web app slows down.

Start with the text-only `gemma3:1b` model: pull that name, set `OLLAMA_TEXT_MODEL=gemma3:1b` and `AI_TEXT_PROVIDER=ollama`, then restart web/worker. Keep local photo features disabled initially. The 1B model cannot analyze photos. For a later vision trial use `gemma3:4b`, one photo per batch, and verify latency and quality with references/history included. The smaller context and RAM limit may reject demanding requests. More capable hardware or an explicitly selected cloud vision provider may be needed; the app never switches providers automatically. [Gemma model variants](https://ollama.com/library/gemma3).

The CPU and GPU profiles are alternatives: do not apply the NVIDIA override to this VPS unless a compatible GPU is actually available.

## Upload model files instead of downloading on the server

Upload trusted, Ollama-compatible GGUF/Safetensors weights through your normal server file-transfer tool into `models/` beside the compose file. Git ignores this folder; the container mounts it read-only at `/models`. Do not upload weights through cleaner forms or application media storage.

For a supported single-file GGUF **text** model, create `models/Modelfile`:

```text
FROM /models/my-text-model.gguf
```

Then import it:

```sh
docker compose -f docker-compose.yml -f docker-compose.ollama.yml exec ollama ollama create property-text -f /models/Modelfile
```

Set `OLLAMA_TEXT_MODEL=property-text` and restart web/worker. Vision models require a compatible vision encoder/projector and model-specific format; a bare text GGUF cannot recognize images. Prefer a complete supported Ollama vision package. Respect weights' licenses and available storage. The app never executes uploaded source code or installs weights from browser requests. [Official model import instructions](https://docs.ollama.com/import).

## OpenAI (GPT / ChatGPT models)

1. Create an API project/key in the [OpenAI platform](https://platform.openai.com/api-keys) and configure API billing/model access.
2. Set server-only `OPENAI_API_KEY`, optionally `OPENAI_VISION_MODEL=gpt-4.1` and `OPENAI_TEXT_MODEL=gpt-4.1`, then restart web/worker. Never put keys in `NEXT_PUBLIC_` variables, browser forms, commits or chat. A ChatGPT login is not an API credential.
3. Select **OpenAI (GPT)** in Admin AI configuration, save model `gpt-4.1`, then check access. For drafting too, set `AI_TEXT_PROVIDER=openai` and restart.

Requests use the Responses API, structured outputs, image inputs and `store: false`; this does not imply zero data retention. [OpenAI quickstart](https://developers.openai.com/api/docs/quickstart), [image inputs](https://developers.openai.com/api/docs/guides/images-vision), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Anthropic (Claude)

Existing settings remain compatible. Set `ANTHROPIC_API_KEY` and an account-accessible `ANTHROPIC_MODEL`, restart web/worker, select Anthropic and save/check the vision model. `AI_TEXT_PROVIDER=anthropic` retains the social composer's original default. One provider's credential never enables another provider.

## Previous photos and training

All three providers can receive authorized examples from the same property and form section. This supplies context without continuously fine-tuning the base model. The separate `services/photo-recognition` service still supports property-specific classifier training, enabled through `MODEL_SERVICE_URL`, `MODEL_SERVICE_TOKEN` and the dedicated-recognition switch. Ollama does not automatically configure that service. Historical examples never redefine QA cleanliness standards.

## Deployment status

Checks inspect metadata, not image quality. Review results on representative jobs; unsupported models and malformed output fail safely. Queued QA reviews from a different provider stop after a provider switch; explicitly retry analysis on the review page to use current settings. Requests already sent before a setting change cannot be recalled. This code change does not provision a live server, download weights or verify real inference. Follow the setup on your hosting environment and verify both web and worker connectivity.

Older bulk photos: Auto assign now verifies eligible pre-receipt uploads already saved in the unassigned pool before analysing them. No re-upload is needed. Files owned by a different cleaner, stale/conflicting receipts or unsupported storage layouts still require manual assignment or office review. Redeploy and reload the cleaner form to use this compatibility step.
