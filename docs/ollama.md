# Using Ollama with ChronoWeave

ChronoWeave supports downloaded local models, cloud models through a signed-in local Ollama server, and direct Ollama Cloud access. Choose the connection mode in **Settings → Ollama**.

## Which servers do I start?

| Connection | What must run | Where inference happens | Authentication |
| --- | --- | --- | --- |
| Local server, downloaded model | ChronoWeave and `ollama serve` | Your computer | No app API key |
| Local server, cloud model | ChronoWeave and a signed-in `ollama serve` | Ollama Cloud | `ollama signin` |
| Ollama Cloud, direct access | ChronoWeave only | Ollama Cloud | Ollama API key |

**There is no separate ChronoWeave relay command.** The relay starts inside Vite when you run `npm run dev` or `npm run preview`. Only the direct **Ollama Cloud** mode uses it. Local server mode calls the configured Ollama API directly, including when Ollama forwards a cloud-model request.

For development, run this in the project directory:

```bash
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:3000`. For a local production build:

```bash
npm run build
npm run preview
```

Use the preview URL printed by Vite. Copying `dist` to a static host does not provide the cloud relay. The relay accepts local, same-origin requests and forwards only to `https://ollama.com/api`.

## Downloaded models: Linux or Ubuntu WSL

The server hosts all your models; each request chooses a model. You do not start a separate server for each model. Run the Linux commands below in Ubuntu if you use WSL.

1. Check that Ollama is installed with `ollama --version`. If needed, follow the [official Linux installation guide](https://docs.ollama.com/linux).
2. If the systemd service is running, stop it before starting a foreground server:

   ```bash
   sudo systemctl stop ollama
   ```

   If a foreground `ollama serve` is already running, stop it with Ctrl+C in its terminal instead. Do not run both on the same port.
3. In terminal 1, start the server:

   ```bash
   OLLAMA_HOST=127.0.0.1:11434 \
   OLLAMA_ORIGINS="http://localhost:3000,http://127.0.0.1:3000,http://localhost:3002,http://127.0.0.1:3002,http://localhost:4173,http://127.0.0.1:4173" \
   OLLAMA_KEEP_ALIVE=10m \
   ollama serve
   ```

   Leave this terminal running. Adjust `OLLAMA_ORIGINS` to include the exact browser URL if Vite uses another port. These values configure the foreground server; a systemd service needs its own [environment configuration](https://docs.ollama.com/faq#setting-environment-variables-on-linux).
4. In terminal 2, download GPT-OSS and check the model list:

   ```bash
   ollama pull gpt-oss:20b
   ollama list
   curl http://localhost:11434/api/tags
   ```

   The exact ID is `gpt-oss:20b`, not `gpt-oss-20b`. Optional preloading avoids loading it during the first app request:

   ```bash
   ollama run gpt-oss:20b ""
   ```

   For interactive chat, run `ollama run gpt-oss:20b` without the empty argument and type `/bye` when finished. The app can also load an installed model itself; an interactive chat need not remain open.
5. In ChronoWeave Settings, choose **Ollama → Local server**, set URL `http://localhost:11434`, click **Refresh models**, and select `gpt-oss:20b`. Test the connection and Save. Set a range such as **1800–1900** and click **Weave History**.

Equivalent defaults in `.env.local`:

```dotenv
PROVIDER=ollama
OLLAMA_MODE=local
OLLAMA_BASE_URL=http://localhost:11434
MODEL=gpt-oss:20b
```

No API key is required. Restart ChronoWeave after changing environment defaults. Saved Settings take precedence. WSL localhost forwarding must make the Ubuntu server reachable from the Windows browser. A foreground server and systemd service can use different model directories because they run as different users; pull/list models through the server you intend to use.

### Pull and switch to another local model

For example, try the smaller [Llama 3.2 3B model](https://ollama.com/library/llama3.2:3b):

```bash
ollama pull llama3.2:3b
ollama run llama3.2:3b ""
ollama list
ollama ps
```

Refresh models in Settings, select `llama3.2:3b`, and Save. The server does not need restarting. For other models, copy an exact chat-model tag from the [Ollama library](https://ollama.com/library), pull it, and repeat the selection steps. Embedding-only models cannot generate timeline data.

## Cloud models through the local server

Keep `ollama serve` running as above, then sign in and make the chosen cloud aliases available:

```bash
ollama signin
ollama pull gpt-oss:20b-cloud
ollama pull gemma4:31b-cloud
ollama list
```

These aliases use cloud inference rather than downloading the model weights for local computation. Optional checks:

```bash
ollama run gpt-oss:20b-cloud "Say hello in one sentence."
ollama run gemma4:31b-cloud "Say hello in one sentence."
```

In ChronoWeave keep **Local server** selected and choose either cloud alias from **Refresh models**. Ollama handles cloud authentication; leave the app API key unset. Example `.env.local` configurations:

```dotenv
# GPT-OSS through the signed-in local server
PROVIDER=ollama
OLLAMA_MODE=local
OLLAMA_BASE_URL=http://localhost:11434
MODEL=gpt-oss:20b-cloud
```

```dotenv
# Gemma 4 through the signed-in local server
PROVIDER=ollama
OLLAMA_MODE=local
OLLAMA_BASE_URL=http://localhost:11434
MODEL=gemma4:31b-cloud
```

Sign-in must belong to the Ollama installation/server you use. Cloud access depends on your account's model availability and usage limits. See [Ollama authentication](https://docs.ollama.com/api/authentication) and the [Gemma cloud model](https://ollama.com/library/gemma4:31b-cloud).

## Direct Ollama Cloud: no local Ollama server

1. Create a key at [Ollama API key settings](https://ollama.com/settings/keys).
2. Configure `.env.local` and start/restart ChronoWeave with `npm run dev`. The cloud relay starts automatically with it:

   ```dotenv
   PROVIDER=ollama
   OLLAMA_MODE=cloud
   MODEL=gpt-oss:20b
   OLLAMA_API_KEY=your_ollama_api_key
   ```

   For a second example, use `MODEL=gemma4:31b` with the other values unchanged. Direct-cloud IDs come from the cloud catalog, not the local `-cloud` aliases.
3. In Settings choose **Ollama → Ollama Cloud**, refresh models, select `gpt-oss:20b` or `gemma4:31b`, and Save. Leave the key field blank to use the configured server key. Alternatively, enter a key in the dialog; it stays in memory for the open page and is cleared on reload.
4. Test the connection and click **Weave History**. `ollama serve`, `ollama signin`, and `ollama pull` are unnecessary for this direct connection.

`OLLAMA_API_KEY` remains server-side. Do not use the Gemini/OpenRouter `API_KEY` variable for Ollama. For local production preview, use `.env.production`, run `npm run build`, then `npm run preview`; its Vite server also includes the relay.

Check currently available direct-cloud names with **Refresh models**, or:

```bash
curl https://ollama.com/api/tags
```

The example names above were checked against that catalog on 2026-10-03. Use current catalog names if a model is renamed or retired. See [Ollama Cloud](https://docs.ollama.com/cloud).

## Model IDs at a glance

| Example | Settings connection | Model ID | Download local weights? |
| --- | --- | --- | --- |
| Local GPT-OSS | Local server | `gpt-oss:20b` | Yes |
| Local Llama | Local server | `llama3.2:3b` | Yes |
| Cloud GPT-OSS via Ollama | Local server | `gpt-oss:20b-cloud` | No |
| Cloud Gemma via Ollama | Local server | `gemma4:31b-cloud` | No |
| Direct cloud GPT-OSS | Ollama Cloud | `gpt-oss:20b` | No |
| Direct cloud Gemma | Ollama Cloud | `gemma4:31b` | No |

## Troubleshooting

### “Invalid historical date range”

This means a model response reached the app; starting another relay will not resolve it. ChronoWeave displays only events whose end year minus start year is at least three. Shorter events are filtered out of model responses and cached timelines rather than treated as invalid dates. An event batch containing only short events, or an empty event batch, does not fail the build. Historical dates are never stretched to make an event qualify.

Reversed dates remain invalid. The error now identifies the entry and its date values. The one corrective retry receives the previous response and specific validation feedback. Prompts specify negative years for BCE dates and chronological ordering. Invalid numeric fields, categories, incomplete JSON, and reversed dates can still fail after correction; a failed build preserves the existing timeline and cache. Switching models does not guarantee factual accuracy or schema compliance.

### Slow requests

Start with 1800–1900. A 600–1600 build uses 21 sequential generation requests before retries. The app does not start generation on page load; it restores cached data or waits for **Weave History**. Reasoning is off by default for Ollama: requests use `think: false` to avoid a reasoning trace before the final answer. GPT-OSS is an exception: it cannot fully disable reasoning, so off uses low effort. Each generation request has a three-minute timeout.

In Settings, **Enable reasoning** opts in for models that support it; GPT-OSS then uses medium effort. This setting applies to all Ollama operations, including the connection test, and persists separately for Local server and Ollama Cloud. Set `OLLAMA_REASONING=true` in `.env.local` or `.env.production` to opt in through configuration; saved Settings take precedence. Existing profiles default to off. Reasoning may help complex questions but adds latency and does not guarantee accurate history. Saved answers remain cached; enable reasoning before an explicit build or an uncached request to use it.

Both **Local server** with a cloud alias and **Ollama Cloud** run inference remotely. Local mode forwards through your signed-in Ollama daemon; direct mode forwards through ChronoWeave's Vite relay with a Bearer API key. The app uses the same generation prompts, batches, validation and reasoning settings in both modes. An API key itself does not add model computation. Network routing, remote queueing and retries can still differ, so do not infer a particular cloud-side cause from elapsed time alone. Nemotron's default reasoning is one measurable source of extra work; see [Ollama thinking controls](https://docs.ollama.com/capabilities/thinking).

`ollama ps` shows loaded local models and CPU/GPU allocation. Local model loading, output size, hardware, and cloud queueing can affect latency. Preload a local model or try a smaller chat model if needed, then check its output quality. A successful connection test confirms a small generation request, not the quality of a full historical timeline.

### Connection errors

For a key generated on ollama.com, choose **Ollama → Ollama Cloud**, enter the key, and select an exact model from **Refresh models** (for example `gemma4:31b`, rather than the local alias `gemma4:31b-cloud`). **Test connection** uses the draft settings; you do not need to save first. Its result stays inside Settings until you change a field or close the dialog. Cloud tests have a 60-second total deadline; local tests allow three minutes for loading. **Stop test** cancels a pending test. Normal generation requests retain their three-minute timeout.

The catalog lists models, but does not guarantee access for your account. A 403 response can indicate that a model requires another subscription; a 429 can indicate shared account limits. The test displays Ollama's error details. It makes one small **Reply with OK** request, accepts a nonempty completed answer, and does not retry or require historical JSON. A successful test verifies connectivity and generation; full timeline responses still undergo validation and corrective retries. Direct cloud mode needs no `ollama serve` or `ollama signin`; start ChronoWeave with `npm run dev` or `npm run preview`, which provides the relay automatically. Click **Save** to persist a Settings key across reloads, or configure server-side `OLLAMA_API_KEY`. Clearing the saved key and saving again uses the server key when available.

- **Cannot reach Ollama:** verify `ollama serve`, the Settings URL, WSL forwarding, and `OLLAMA_ORIGINS`.
- **Cannot reach the cloud relay:** use the app served by `npm run dev` or `npm run preview`; a static `dist` host has no relay.
- **401/403:** check the direct-cloud API key, or sign in to the local server for cloud aliases.
- **404/model not found:** refresh the selected mode's model list and use its exact ID.
- **429/quota:** inspect your Ollama account usage; a different model can share the same account quota.

## Relationship mapping and caches

Successful **Map Relationships** results are saved in your browser's localStorage under `chrono_map_*`, including results with no connections. Closing the relationship dialog or clicking empty canvas space hides the curves without clearing the saved map. Mapping the same figure again on the same canvas restores the same connections without another model request, including after a page reload.

The cache covers the source and the figures currently on the timeline. Adding, removing, or changing figures requires a new search; panning, zooming, sorting, and category filters do not. Known relationship pairs remain reusable in either direction while both endpoints are unchanged. For example, mapping Newton to Galileo lets Galileo's map show Newton immediately, including after reload. Only remaining candidates need a model request. A failed search for additional connections preserves the known ones and can be retried; it is not cached as a completed map. **Expand Timeline** saves its discovered connections against the expanded timeline, so a subsequent map can reuse them. Failed or cancelled requests do not save an empty result.

If mapping finds no connections on the canvas, ChronoWeave automatically tries **Expand Timeline** within the current year range. If that also finds nothing, the connections overlay keeps the focus card visible and shows a message. A completed empty expansion is remembered for that source and canvas, so repeated mapping does not repeat both model requests. Use **Expand Timeline** explicitly to try again, or build a different year range.

Relationship explanations (`chrono_rel_*`) and biographies (`chrono_deepdive_*`) have separate caches. Reading the same relationship again, including from the other figure, reuses its explanation with the figure details in the correct order. These caches and relationship maps are shared across providers and models; switching models affects uncached requests and explicit builds. Clearing browser site data clears these caches too.

### “Invalid related figure IDs” / “Unrecognized related figure IDs”

The model returned identifiers that do not match the supplied candidates, or returned an incorrectly shaped `relatedIds` list. The older generic error rejected an entire response if it contained a name instead of an ID, a self reference, or an unknown ID. Ollama now receives short candidate IDs such as `c1`; the app translates them to real timeline IDs. Unambiguous candidate names are also resolved, self references are removed, and unknown IDs cannot become connections. Valid connections are retained when a response also contains unknown IDs. A response containing only unrecognized values receives one correction with specific feedback, then reports an error while preserving any cached connections.

## Stop a model or the server

```bash
ollama stop gpt-oss:20b   # Unload one model while leaving the API running
```

Press Ctrl+C in the foreground server terminal to stop the API, or `sudo systemctl stop ollama` for a systemd server. Downloaded models remain available for future runs. The [CLI reference](https://docs.ollama.com/cli) covers further model management.
