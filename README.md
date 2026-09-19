# OpenAI API Desk (AI_API_Desk)

An unofficial, browser-only client for the OpenAI API. You paste your own API key, press **INIT**, pick a model that your key can actually use, and send requests to the **Responses API** (`POST https://api.openai.com/v1/responses`).

- Runs entirely in your browser. No backend of ours, no accounts, no database, no telemetry.
- Plain HTML, CSS and JavaScript. No install, no build step, no dependencies.
- OpenAI only. It is not a multi-provider client.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page layout. |
| `styles.css` | Dark developer-tool styling. |
| `app.js` | All behaviour: INIT, request building, API calls, Markdown rendering, result display. |
| `README.md` | This file. |

## How INIT works

1. On load, only **API key** and **INIT** are enabled. Everything else (model, parameters, prompt, attachments, tools, RUN) is locked. This is enforced in JavaScript, not just styled: the workspace is a disabled `<fieldset>`, and `run()` also refuses to do anything until INIT has succeeded.
2. INIT calls `GET /v1/models` with your key.
3. If OpenAI accepts the key and returns models, the workspace unlocks and the model list is filled from that response.
4. If anything fails (wrong key, restricted key, no models, network problem), the workspace stays locked and the reason is shown. A restricted key that may not list models cannot INIT.
5. Editing the key afterwards locks the workspace again, so the model list always belongs to the key in the field.

The model list is never hardcoded. The dropdown hides IDs that cannot be the main model of a text request (embeddings, realtime, audio, image, moderation and similar). Tick **Show every model ID the API returned** to see the unfiltered list. No model is pre-selected; you choose one.

## How the key is used

- It is typed into a password field and copied into one JavaScript variable at INIT.
- It is sent only in the `Authorization` header of requests to `https://api.openai.com/v1/...`.
- It is not stored (no localStorage, no cookies), not logged, and not placed in any request body. It disappears when you close or reload the page.
- If OpenAI echoes part of a key in an error message, the key is replaced with `[hidden]` before display.

## What it can do

### Parameters (only documented ones, only when the model supports them)

| Control | API field | Notes |
| --- | --- | --- |
| Max output tokens | `max_output_tokens` | Minimum 16. Includes reasoning tokens. Offered for every model. |
| Reasoning effort | `reasoning.effort` | Offered only for models in the rules table in `app.js`. |
| Temperature | `temperature` | Offered only for non-reasoning GPT-4-generation model IDs. Range 0 to 2. |
| Top P | `top_p` | Same rule. Range 0 to 1. |
| Instructions | `instructions` | Optional. |

Nothing else is sent. There is no `top_k`: it is not a Responses API parameter.

**Why a rules table?** `GET /v1/models` returns only model IDs and OpenAI publishes no machine-readable list of what each model supports. So `app.js` contains a small table, matched by model ID, built from the official docs: GPT-6 Astra (effort low to max; `temperature` and `top_p` unsupported), the GPT-5.6 family (effort none to max), GPT-5.1 (none, low, medium, high), GPT-5 Pro (high only), other GPT-5/o-series reasoning models (low, medium, high only), and GPT-4-generation models (sampling parameters). A model that matches no rule gets only max output tokens. This is deliberately conservative: it may hide something a newer model supports, but it should never send a parameter that is not documented for that model. Edit the table at the top of `app.js` to change it.

### Prompt and attachments

- **Images** (PNG, JPEG, WEBP, non-animated GIF) are sent inline as `input_image` data URLs. Limit set by this page: 20 MB each.
- **Documents** are uploaded to your OpenAI Files storage (`POST /v1/files`, purpose `user_data`) and referenced as `input_file` with a `file_id`. Limit set by this page: 50 MB each, matching the file inputs guide. With **Delete uploaded documents from OpenAI after RUN** ticked (the default), each document is deleted again after RUN (`DELETE /v1/files/{id}`), and is also uploaded with a one-hour expiry as a safety net in case deletion fails. Untick it and the file stays in your account.
- These attachments belong to the current request only. This is different from File Search below.

### Tools (off by default, sent only when ticked)

- **Web search**: `{ "type": "web_search" }` with optional `search_context_size`. The request also sets `include: ["web_search_call.action.sources"]`. Cited pages and consulted sources are listed under the answer as links.
- **File Search (document collection / Vector Store)**: `{ "type": "file_search", "vector_store_ids": [...] }`. You can list your vector stores, create one, and upload documents into the selected one (`POST /v1/files` with purpose `assistants`, then `POST /v1/vector_stores/{id}/files`, then the page waits for processing). Cited file names are shown. Vector stores and their files stay in your OpenAI account until you delete them elsewhere; storage may be billed by OpenAI.
- **Image generation**: `{ "type": "image_generation" }` with optional `model`, `size`, `quality`, `output_format`, `output_compression`, `background` and `moderation`. The image models offered are those on the documented list that your key also returned. `xhigh` and `max` quality appear only for the `gpt-image-2.5-*` models. By default `tool_choice` is set to `{ "type": "image_generation" }` so an image is produced; untick **Always generate an image** to let the model decide. The returned base64 image is shown as a picture with a download link. OpenAI may require organization verification for GPT Image models.

### Response

- The answer is rendered as Markdown: headings, bold, italic, strikethrough, inline code, fenced code blocks, links, bullet and numbered lists (nested), blockquotes, rules and tables. The renderer builds DOM nodes and never uses HTML strings, so model output cannot inject markup. Only `http`, `https` and `mailto` links are kept, and remote Markdown images are never loaded (they become links).
- **Model reported by the API**: shown in the Usage area, taken from the response's `model` field.
- **Usage**: input, cached input, output, reasoning and total tokens, exactly as the response's `usage` object reports them. Nothing is estimated. Other charges, such as per-call tool fees, are not shown.
- **Request sent**: a collapsible copy of the JSON body (long data URLs shortened, no key), so you can check what was sent.
- Errors are explained in plain language for 401, 403, 404, 413, 429 (quota versus rate limit), 400/422, 5xx and network failures, followed by OpenAI's own message.

## Not implemented

- **Remaining balance / credit**: left out on purpose. As far as the official documentation shows, there is no supported API that returns remaining credit for an ordinary API key. The documented Costs API needs a separate admin key and reports spend, not balance. The dashboard billing endpoints are undocumented and meant for OpenAI's own website, and this project will not use them.
- Streaming, background mode, multi-turn conversations, structured outputs, function calling, MCP tools, code interpreter, computer use.
- Image editing with masks, custom image sizes, web search domain filters or location.
- Deleting vector stores or listing their files.

## Security notes

- Anyone who can run JavaScript on this page can read the key while it is loaded. Only host it where you trust the code, and use a key with a spending limit that you can revoke.
- Browser extensions can read page contents, including the key field.
- The page is served by whoever hosts it (for example Vercel). That host serves the files but never receives the key, as long as the code is unchanged.

## Browser and CORS limitations

- The page calls `api.openai.com` directly from the browser. That only works if OpenAI's servers answer the browser's cross-origin checks. **This was not verified against the live API during development** (see below). If the browser refuses, the page shows a network/CORS message and there is nothing this page can do about it. Fixing it would require a proxy, and this project deliberately has none.
- A request waits for the complete answer. Very long reasoning runs may hit a browser or network timeout. Streaming and background mode are not implemented.
- Images and documents are held in browser memory while a request is prepared, so very large attachments can be slow.

## Deploy to Vercel

It is a static site: nothing to build and no extra files.

1. Put the four files at the top level of a GitHub repository.
2. On vercel.com choose **Add New > Project** and import the repository.
3. Set **Framework Preset** to **Other**. Leave Build Command, Output Directory and Install Command empty.
4. Press **Deploy**, open the address, enter your key, press INIT.

Or with the Vercel command-line tool: run `vercel`, then `vercel --prod`, in this folder. If visitors see a Vercel login page, check **Settings > Deployment Protection**.

## Verification status

- Request and response structures were checked against the current official OpenAI documentation (Responses API reference, text, images and vision, file inputs, web search, file search and retrieval, image generation, reasoning and model pages, Files and Vector Stores references, Models list).
- The page was exercised in a simulated browser and in Chromium against a **mocked** OpenAI API: locked state, failed and successful INIT, model list, parameter gating, request bodies, attachments, vector store calls, error handling, Markdown rendering, image display.
- It was **not** run against the live OpenAI API. Live behavior depends on your account, your key's permissions, model access and OpenAI's CORS policy. Please report anything that differs.

## Official documentation used

- Responses API reference: https://platform.openai.com/docs/api-reference/responses
- Text generation: https://platform.openai.com/docs/guides/text
- Models: https://platform.openai.com/docs/models
- Images and vision, file inputs, web search, file search, retrieval, image generation, reasoning: under https://platform.openai.com/docs/guides/
- Files, Vector Stores and Models list references: under https://platform.openai.com/docs/api-reference/
