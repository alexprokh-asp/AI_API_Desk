# OpenAI API Desk

A browser-only developer tool for calling the OpenAI Responses API and inspecting exactly what is sent and received. Plain HTML, CSS and JavaScript. No backend, no build step, no dependencies, no analytics.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Layout and all controls (element IDs are a stable contract) |
| `styles.css` | Design tokens (CSS variables), shared component classes, layout |
| `app.js` | Everything else: API calls, capability rules, request builder, inspector, Markdown |
| `README.md` | This file |

## Run it

Serve the folder over HTTP and open it:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Deploy on Vercel as a plain static site: import the folder, framework preset "Other", no build command, no output directory.

Then paste your API key and press **INIT**.

## How it behaves

- **INIT gate.** The key is kept in memory only (never stored; reloading clears it). INIT calls `GET /v1/models`. Until it succeeds, every other control is disabled. Editing the key afterwards locks the app again.
- **Explicit model choice.** Nothing is pre-selected and the app never switches models for you. By default the list shows text/reasoning models; "Show all models" lists everything the API returned.
- **Capability-aware controls.** Reasoning efforts, temperature/top_p, hosted tools and image input are enabled or disabled per model. Disabled parameters are not sent. "Ignore inferred limits" turns the gating off so you can reproduce API errors deliberately.
- **Only what you set is sent.** Empty fields, "Default (not sent)" selections and cleared sliders are omitted from the request body.
- **Request inspector.** The Request tab shows the method, endpoint, headers (key always `Bearer ********`) and the JSON body. It updates live as you change controls ("Preview") and switches to the exact body once you press Run ("Sent request"). Copy JSON and Copy cURL are available. Very long base64 strings are shortened in the view; Copy JSON contains the full body.
- **Response inspector.** Full response JSON, the response headers the browser is allowed to read, a Usage tab (every field in `usage`, including cached and reasoning tokens), and an Errors tab (HTTP status, type, code, param, message, request ID, plus a short hint). Download JSON saves the raw response.
- **Rendering.** Markdown with headings, lists, tables, blockquotes, links, inline code and fenced code blocks (with syntax highlighting and Copy). HTML in model output is escaped, never interpreted. Generated images, reasoning summaries, tool calls and citations are shown.
- **Attachments.** Images are sent inline as `input_image` data URLs (a model without image input, such as `gpt-4`, is reported before anything is sent). Documents are uploaded to the Files API (`purpose: user_data`) and referenced with `input_file.file_id`. **Delete uploads** removes the files uploaded in this session from your OpenAI account.
- **Knowledge base.** List and create vector stores, view files and their status, upload files (purpose `assistants`, then attached to the store, with status polling), and an operation log. File search uses the selected store.
- **Theme.** Light only. The palette lives in the `:root` tokens at the top of `styles.css` (canvas `#FFFFFF`, sidebar `#F9F9F9`, inputs/cards `#F4F4F4`, text `#0D0D0D`, muted `#676767`, accent `#3B82F6` / hover `#2563EB`, borders `#E5E5E5`). Change colors there, nowhere else.
- **Layout.** The left panel resizes by dragging its right edge (280–520 px, or with the arrow keys when focused). Below 900 px it becomes a drawer.
- **Content-Security-Policy.** `index.html` only allows connections to `https://api.openai.com`, so the key cannot be sent anywhere else by this page.

## Capability rules (please read)

`GET /v1/models` returns only `id`, `created` and `owned_by`. It contains no capability data, so the rules in `getCaps()` (in `app.js`) are inferred from model names and OpenAI's published documentation:

- Reasoning effort values are model-dependent. GPT-5.6 documents `none, low, medium, high, xhigh, max`; GPT-6 Astra has no `none`; earlier families accept fewer values. Reasoning models reject custom `temperature`/`top_p` (some GPT-5.x models accept them only with effort `none`).
- Hosted tools are assumed available for the GPT-4o / 4.1 / 5 / 6 and o3-class families, and disabled for older or unknown models.

Names change faster than this table. If a new model is wrongly restricted, use "Ignore inferred limits" and update `getCaps()`.

## Testing checklist

1. Wrong key: INIT shows the HTTP status, error code and message; the app stays locked.
2. Valid key: models load, the count shows, the panel unlocks, no model is selected.
3. Select `gpt-4`, attach an image: the app explains that the model has no image input and sends nothing.
4. Select `gpt-4.1`, attach an image, ask "What is in this image?": the request shows an `input_image`; the response renders.
5. Select a reasoning model: Temperature and Top P are disabled and absent from the Request tab; the reasoning list matches the model.
6. Enable Web search: the Request tab shows the `web_search` tool and `include`.
7. Set a parameter the model rejects with "Ignore inferred limits" on: the Errors tab shows the API error verbatim.
8. Search the Request tab and the page source for your key. It must never appear (only `Bearer ********`).

The automated checks used during development ran against a mocked `fetch`. **They have not been run against the live OpenAI API.**

## Limitations

- Each Run is an independent request. There is no conversation memory between turns (`previous_response_id` is not used).
- No streaming. Long reasoning runs show a timer and a Stop button; stopping cancels in the browser only.
- MCP tools, function calling, and downloading files created by Code Interpreter are not implemented.
- Vector store files cannot be removed from the app.
- Browsers expose only some response headers, so `x-request-id` may be missing; the app also looks for `req_…` IDs inside error messages.
- OpenAI stores Responses by default; this app does not change that setting.

## Ideas for later (not implemented)

Conversation continuation, streaming, saved request presets, removing vector store files, cost estimates from usage, MCP tools.
