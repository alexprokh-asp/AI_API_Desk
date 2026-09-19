// AI Workspace: everything the page does lives in this one file.
// Nothing is saved anywhere. The API key exists only in the key field
// while this page is open, and it is never logged.


/* ==================================================================
   1. Settings you can edit
   ================================================================== */

// Where requests are sent (the OpenAI "Responses" endpoint).
const API_URL = "https://api.openai.com/v1/responses";

// Models shown in the dropdown. "id" is sent to the API exactly as written.
// Add, remove or rename entries freely.
const MODELS = [
  { id: "gpt-5",        label: "GPT-5" },
  { id: "gpt-5-mini",   label: "GPT-5 mini" },
  { id: "gpt-4.1",      label: "GPT-4.1" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
];


/* ==================================================================
   2. The API format
   These two functions are the only place that knows how the provider
   expects requests and formats answers. To support another provider
   later, this is the part that changes.
   ================================================================== */

// Turns the form values into the request we send.
function buildRequest(apiKey, model, prompt) {
  return {
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey,
    },
    body: JSON.stringify({ model: model, input: prompt }),
  };
}

// Pulls the useful parts out of the API's JSON answer.
function readResponse(data) {
  // The answer text is nested inside data.output[].content[].
  const texts = [];
  for (const item of data.output || []) {
    if (item.type !== "message") continue;
    for (const part of item.content || []) {
      if (part.type === "output_text") texts.push(part.text);
      if (part.type === "refusal") texts.push(part.refusal);
    }
  }

  let notice = "";
  if (data.status === "incomplete") {
    const reason = data.incomplete_details && data.incomplete_details.reason;
    notice = "The response is incomplete" + (reason ? " (" + reason + ")." : ".");
  }

  const u = data.usage;
  return {
    text: texts.join("\n\n"),
    notice: notice,
    usage: u ? { input: u.input_tokens, output: u.output_tokens, total: u.total_tokens } : null,
    modelUsed: data.model || "",
  };
}


/* ==================================================================
   3. Page elements
   ================================================================== */

const keyInput    = document.getElementById("api-key");
const modelSelect = document.getElementById("model");
const promptInput = document.getElementById("prompt");
const runButton   = document.getElementById("run");
const responseBox = document.getElementById("response");
const usageInput  = document.getElementById("usage-input");
const usageOutput = document.getElementById("usage-output");
const usageTotal  = document.getElementById("usage-total");
const usageExtra  = document.getElementById("usage-extra");


/* ==================================================================
   4. Showing things on screen
   ================================================================== */

// Fills the model dropdown. The first entry is a placeholder, so the user
// always has to choose a model on purpose.
function fillModelList() {
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a model";
  modelSelect.appendChild(placeholder);

  for (const model of MODELS) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label;
    modelSelect.appendChild(option);
  }
}

// kind is "empty", "loading", "error", or nothing for a normal answer.
// textContent (not innerHTML) means the answer can never run as code.
function setResponse(text, kind) {
  responseBox.textContent = text;
  responseBox.className = "response" + (kind ? " is-" + kind : "");
}

function showError(message) {
  setResponse(message, "error");
}

function addNotice(text) {
  const note = document.createElement("div");
  note.className = "response-notice";
  note.textContent = text;
  responseBox.appendChild(note);
}

function formatNumber(value) {
  return typeof value === "number" ? value.toLocaleString("en-US") : "–";
}

function clearUsage() {
  usageInput.textContent = "–";
  usageOutput.textContent = "–";
  usageTotal.textContent = "–";
  usageExtra.textContent = "";
}

function showUsage(usage, modelUsed) {
  if (usage) {
    usageInput.textContent = formatNumber(usage.input);
    usageOutput.textContent = formatNumber(usage.output);
    usageTotal.textContent = formatNumber(usage.total);
  }
  const lines = [];
  if (modelUsed) lines.push("Model reported by the API: " + modelUsed + ".");
  lines.push("Cost: not calculated. The API does not return a price.");
  usageExtra.textContent = lines.join(" ");
}

function setLoading(isLoading) {
  runButton.disabled = isLoading;
  runButton.textContent = isLoading ? "Running..." : "RUN";
}


/* ==================================================================
   5. Errors
   ================================================================== */

// Providers sometimes echo part of a key back in their error text.
// This removes the key before anything is shown.
function hideKey(text, apiKey) {
  return apiKey ? String(text).split(apiKey).join("[hidden]") : String(text);
}

function explainHttpError(status, data, apiKey) {
  let message;
  if (status === 401) {
    message = "The API rejected your key. Check that it is correct and still active.";
  } else if (status === 403) {
    message = "Your key does not have permission for this model or action.";
  } else if (status === 404) {
    message = "The API could not find this model, or your key cannot use it. " +
              "Choose a different model, or edit the list at the top of app.js.";
  } else if (status === 429) {
    message = "Too many requests, or your quota or credit is used up. " +
              "Wait a moment and check your plan and billing with the provider.";
  } else if (status === 400) {
    message = "The API did not accept this request.";
  } else if (status >= 500) {
    message = "The API is having problems. Try again in a moment.";
  } else {
    message = "The request failed (status " + status + ").";
  }

  const providerText = data && data.error && data.error.message;
  if (providerText) {
    message += "\n\nMessage from the provider:\n" + hideKey(providerText, apiKey);
  }
  return message;
}


/* ==================================================================
   6. RUN
   ================================================================== */

async function run() {
  const apiKey = keyInput.value.trim();
  const model  = modelSelect.value;
  const prompt = promptInput.value.trim();

  // Check the form first.
  if (!apiKey) return showError("Enter your API key.");
  if (!model)  return showError("Select a model.");
  if (!prompt) return showError("Write a prompt.");

  setLoading(true);
  setResponse("Waiting for the response...", "loading");
  clearUsage();

  try {
    const request = buildRequest(apiKey, model, prompt);
    const reply = await fetch(API_URL, {
      method: "POST",
      headers: request.headers,
      body: request.body,
    });

    // The body may not be JSON (for example on some server errors).
    const data = await reply.json().catch(() => null);

    if (!reply.ok) {
      showError(explainHttpError(reply.status, data, apiKey));
      return;
    }
    if (!data) {
      showError("The API sent an answer this page could not read.");
      return;
    }

    const result = readResponse(data);
    setResponse(result.text || "The model returned no text.", result.text ? "" : "empty");
    if (result.notice) addNotice(result.notice);
    showUsage(result.usage, result.modelUsed);

  } catch (error) {
    // No reply at all: offline, blocked, or refused by the browser's cross-origin (CORS) rules.
    showError("Could not reach the API. Check your internet connection and any browser " +
              "extension or network filter that might block it. If the browser console " +
              "(press F12) mentions CORS, the provider is refusing requests from web pages.");
  } finally {
    setLoading(false);
  }
}


/* ==================================================================
   7. Start
   ================================================================== */

fillModelList();
runButton.addEventListener("click", run);
