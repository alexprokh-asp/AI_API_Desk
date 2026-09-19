# AI Workspace

A small page for sending a prompt straight to an AI API. Think of it as a visual alternative to writing CURL commands.

- Runs entirely in your browser. No backend of our own, no accounts, no database, no telemetry.
- Your API key stays in the page's memory and is sent only to the API provider.
- Plain HTML, CSS and JavaScript. No install, no build step.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The page layout: key, model, prompt, RUN, response, usage. |
| `styles.css` | How it looks. Light and dark mode follow your system. |
| `app.js` | What it does: checks the form, sends the request, shows the answer. |
| `README.md` | This file. |

## Run it on your computer

Double-click `index.html`. It opens in your browser.

## Deploy to Vercel

This is a static site. Vercel only hosts the four files: nothing to build, no extra files needed.

1. Put the four files at the top level of a GitHub repository (`index.html` must not be inside a subfolder).
2. On vercel.com choose **Add New > Project** and import that repository.
3. Set **Framework Preset** to **Other**. Leave Build Command, Output Directory and Install Command empty.
4. Press **Deploy**. Vercel gives you an address like `https://your-project.vercel.app`.
5. Open the address, enter your own API key, choose a model and press RUN.

Alternative without GitHub: install the Vercel command-line tool on your computer, open a terminal in this folder and run `vercel`, then `vercel --prod`. (The tool needs Node.js on your machine, but it is not part of this project.)

If visitors see a Vercel login page instead of the app, open the project's **Settings > Deployment Protection** and check the setting.

Every visitor uses their own API key. The key goes from their browser straight to the API provider. It is never sent to Vercel or to anyone else.

## Test your first request

1. Paste your own OpenAI API key into **API key**.
2. Choose a model from **Model**.
3. Type something short in **Prompt**, for example: `Say hello in one sentence.`
4. Press **RUN**.

The answer appears under **Response**, and token counts appear under **Usage**. The usage area also shows the model name the API reports, so you can confirm it matches what you chose.

## Change the models or the endpoint

Open `app.js`. The top of the file has two settings:

- `API_URL`: where requests are sent.
- `MODELS`: the dropdown list. Each entry has an `id` (sent to the API exactly as written) and a `label` (what you see).

Edit the list, save, and reload the page (or push the change to GitHub so Vercel redeploys).

## Privacy and security

- The key is typed into a password field and lives only in that field.
- It is sent only to `API_URL`, only when you press RUN.
- It is not saved (no localStorage, no cookies) and not logged. Reloading or closing the page forgets it.
- If the provider's error text contains your key, the key is replaced with `[hidden]` before display.
- A key typed into any web page is exposed to that page's code and to your browser extensions. Only use this on a device and browser you trust, and use a key with a spending limit that you can revoke.

## Limitations of this MVP

- One provider only (the OpenAI Responses API).
- One prompt, one answer. No conversation history: each RUN is a fresh request.
- Answers appear all at once, not streamed word by word.
- Response is shown as plain text (no Markdown rendering).
- Cost is not calculated. Only token counts are shown.
- The key is not remembered between page loads, so you paste it each time.
- The model list is written by hand and may not match what your account can use.
- No settings such as temperature or a system prompt.
- The page calls the provider directly from the browser, so it only works with providers that allow that (CORS).

## Troubleshooting

**"Could not reach the API"**: you may be offline, an extension or network filter may be blocking the request, or the provider may be refusing requests from web pages. Press F12 and look at the Console: a message mentioning CORS means the provider is refusing the request.

**Works on Vercel but not when double-clicking `index.html`** (or the reverse): some browsers restrict pages opened directly from disk. Start a tiny local server and open the address it prints:

```
python -m http.server 8000
```

Then visit `http://localhost:8000`. This only serves the files.

**"The API could not find this model"**: the model id is not available to your account. Edit `MODELS` in `app.js`.

## Later (not built yet)

File uploads, File Search, Web Search, Code Interpreter, image generation, conversation history, multiple providers, MCP tools, Computer Use / browser automation, local AI models, detailed token and cost tracking.
