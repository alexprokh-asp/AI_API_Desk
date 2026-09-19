"use strict";

// OpenAI API Desk: a browser client for the OpenAI Responses API (unofficial).
// Nothing is saved anywhere. The API key lives only in this page's memory,
// is sent only to API_BASE, and is never logged.
//
// Every request structure below was checked against the official OpenAI docs
// (API reference for Responses, Files, Vector Stores, Models; guides for file
// inputs, images, web search, file search, image generation, reasoning).
// The links are listed in README.md.


/* ==================================================================
   1. Settings and documented rules (edit here)
   ================================================================== */

const API_BASE = "https://api.openai.com/v1";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;   // request limit for image data URLs in the API reference
const MAX_FILE_BYTES  = 50 * 1024 * 1024;   // "each file must be under 50 MB" (file inputs guide)
const POLL_INTERVAL_MS = 2000;              // vector store file processing check
const POLL_TIMEOUT_MS  = 120000;

// Image models the Responses "image_generation" tool accepts in its `model`
// field, exactly as listed in the API reference. Only those that the API also
// returned for your key are offered.
const IMAGE_TOOL_MODELS = [
  "gpt-image-1", "gpt-image-1-mini", "gpt-image-1.5",
  "gpt-image-2", "gpt-image-2-2026-04-21",
  "gpt-image-2.5-sunburst", "gpt-image-2.5-sunburst-2026-09-08",
  "gpt-image-2.5-flare", "gpt-image-2.5-flare-2026-09-08",
  "chatgpt-image-latest",
];
// Per the reference: xhigh and max quality exist only for the 2.5 models.
const IMAGE_QUALITY_EXTRA = /^gpt-image-2\.5-/;

// GET /v1/models returns only IDs. It does not say what a model can do, and
// OpenAI publishes no per-model parameter table. So the choices offered for
// reasoning effort and sampling come from this list, matched by model ID.
// The first matching rule wins. A model that matches nothing gets no
// reasoning or sampling controls. That is deliberate: it never sends a
// parameter that is not documented for the model.
const MODEL_RULES = [
  {
    name: "GPT-6 Astra",
    match: id => /^gpt-6-astra/.test(id),
    reasoning: ["low", "medium", "high", "xhigh", "max"],
    sampling: false,
    source: "Model page: reasoning.effort supports low, medium, high, xhigh, max. Model guide: temperature and top_p are unsupported.",
  },
  {
    name: "GPT-5.6",
    match: id => /^gpt-5\.6/.test(id),
    reasoning: ["none", "low", "medium", "high", "xhigh", "max"],
    sampling: false,
    source: "Model catalog: reasoning none, low, medium, high, xhigh, max. Sampling is left off because it is not documented as supported for this family.",
  },
  {
    name: "GPT-5.1",
    match: id => /^gpt-5\.1(-\d{4}-\d{2}-\d{2})?$/.test(id),
    reasoning: ["none", "low", "medium", "high"],
    sampling: false,
    source: "API reference: gpt-5.1 supports none, low, medium, high.",
  },
  {
    name: "GPT-5 Pro",
    match: id => /^gpt-5-pro/.test(id),
    reasoning: ["high"],
    sampling: false,
    source: "API reference: gpt-5-pro supports only high.",
  },
  {
    name: "Other reasoning model",
    match: id => /^(gpt-5|o3|o4|o1(-\d{4}-\d{2}-\d{2})?$)/.test(id) && !/chat|deep-research/.test(id),
    reasoning: ["low", "medium", "high"],
    sampling: false,
    source: "Only low, medium, high are offered here. Other levels depend on the exact model and are not assumed.",
  },
  {
    name: "GPT-4 generation",
    match: id => /^(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4$|gpt-4-\d|chatgpt-4o|gpt-3\.5)/.test(id),
    reasoning: null,
    sampling: true,
    source: "Non-reasoning model: temperature and top_p are documented request parameters; reasoning is not used.",
  },
];
const DEFAULT_RULE = {
  name: "Unrecognised model",
  reasoning: null,
  sampling: false,
  source: "This model ID is not in the rules table in app.js, so only max output tokens is offered.",
};

// IDs that cannot be used as the main model of a Responses text request.
// This only tidies the dropdown. "Show every model ID" turns the filter off.
const NOT_A_TEXT_MODEL = /image|realtime|gpt-live|audio|tts|transcribe|whisper|embedding|moderation|dall-e|sora|davinci|babbage|instruct|search-preview|computer-use/;


/* ==================================================================
   2. State and page elements
   ================================================================== */

const state = {
  apiKey: "",
  initialized: false,
  modelIds: [],
  images: [],          // File objects attached directly (images)
  docs: [],            // File objects attached directly (documents)
  vectorStores: [],
  vectorStoresLoaded: false,
  busy: 0,
};

const $ = id => document.getElementById(id);

const keyInput = $("api-key");
const initButton = $("init");
const initStatus = $("init-status");
const workspace = $("workspace");
const modelSelect = $("model");
const showAllModels = $("show-all-models");
const modelCount = $("model-count");
const maxOutput = $("max-output");
const reasoningSelect = $("reasoning");
const reasoningHint = $("reasoning-hint");
const temperatureInput = $("temperature");
const temperatureHint = $("temperature-hint");
const topPInput = $("top-p");
const topPHint = $("top-p-hint");
const capabilityNote = $("capability-note");
const instructionsInput = $("instructions");
const promptInput = $("prompt");
const imageInput = $("image-input");
const docInput = $("doc-input");
const attachmentsList = $("attachments");
const attachStatus = $("attach-status");
const deleteUploads = $("delete-uploads");
const toolWeb = $("tool-web");
const webOpts = $("web-opts");
const webContext = $("web-context");
const toolFiles = $("tool-files");
const filesOpts = $("files-opts");
const vsSelect = $("vs-select");
const vsName = $("vs-name");
const vsFiles = $("vs-files");
const vsLog = $("vs-log");
const toolImage = $("tool-image");
const imageOpts = $("image-opts");
const imgModel = $("img-model");
const imgSize = $("img-size");
const imgQuality = $("img-quality");
const imgFormat = $("img-format");
const imgCompression = $("img-compression");
const imgBackground = $("img-background");
const imgModeration = $("img-moderation");
const imgForce = $("img-force");
const runButton = $("run");
const responseBox = $("response");
const usageList = $("usage-list");
const usageExtra = $("usage-extra");
const requestJson = $("request-json");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));


/* ==================================================================
   3. Talking to the API
   ================================================================== */

class ApiError extends Error {
  constructor(kind, status, providerMessage, code) {
    super(kind);
    this.kind = kind;                        // "network" or "http"
    this.status = status || 0;
    this.providerMessage = providerMessage || "";
    this.code = code || "";
  }
}

// A problem with what the user typed. Shown as-is.
class UserInputError extends Error {}

// Providers sometimes echo part of a key in error text. Remove it before display.
function hideKey(text, key) {
  return key ? String(text).split(key).join("[hidden]") : String(text);
}

// One place that talks to OpenAI. The key goes only into this Authorization header.
async function callApi(method, path, options = {}) {
  const key = state.apiKey;
  const headers = { "Authorization": "Bearer " + key };
  let body;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.form) {
    body = options.form;                     // the browser adds the multipart boundary
  }

  let reply;
  try {
    reply = await fetch(API_BASE + path, { method, headers, body });
  } catch (error) {
    throw new ApiError("network");
  }

  const text = await reply.text().catch(() => "");
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (error) { data = null; }

  if (!reply.ok) {
    const info = data && data.error ? data.error : {};
    throw new ApiError("http", reply.status, hideKey(info.message || "", key), info.code || info.type || "");
  }
  return data;
}

function explainError(error) {
  if (error instanceof UserInputError) return error.message;
  if (!(error instanceof ApiError)) {
    return "Unexpected error in this page: " + hideKey(error && error.message ? error.message : error, state.apiKey);
  }
  if (error.kind === "network") {
    return "Could not reach api.openai.com. Check your internet connection and any extension or " +
           "network filter that might block it. If the browser console (F12) mentions CORS, " +
           "the browser is refusing the request and this page cannot work around that.";
  }

  const s = error.status;
  let message;
  if (s === 401) {
    message = "OpenAI rejected the API key. It may be mistyped, revoked, or belong to another organization or project.";
  } else if (s === 403) {
    message = "This key is not allowed to do that. It may be a restricted key without the needed permission, " +
              "the feature may need organization verification, or OpenAI may not serve your region.";
  } else if (s === 404) {
    message = "OpenAI could not find that model or resource, or this key has no access to it.";
  } else if (s === 413) {
    message = "The request is too large. Use smaller files or images.";
  } else if (s === 429) {
    message = error.code === "insufficient_quota"
      ? "This key's project has no remaining quota or credit. Check billing with OpenAI."
      : "Rate limit reached. Wait a moment and try again.";
  } else if (s === 400 || s === 422) {
    message = "OpenAI did not accept the request. Usually the selected model does not support one of the options, or a value is out of range.";
  } else if (s >= 500) {
    message = "OpenAI reported a server error. Try again in a moment.";
  } else {
    message = "The request failed (HTTP " + s + ").";
  }
  message += " (HTTP " + s + ")";
  if (error.providerMessage) message += "\n\nMessage from OpenAI:\n" + error.providerMessage;
  return message;
}


/* ==================================================================
   4. INIT: the gate for the whole workspace
   ================================================================== */

function setBusy(isBusy) {
  state.busy += isBusy ? 1 : -1;
  const busy = state.busy > 0;
  keyInput.disabled = busy;
  initButton.disabled = busy;
}

function setInitStatus(message, kind) {
  initStatus.textContent = message;
  initStatus.className = "status" + (kind ? " is-" + kind : "");
}

// Back to the locked state. Used at load, after a failed INIT, and when the key is edited.
function lockWorkspace(message, kind) {
  state.initialized = false;
  state.apiKey = "";
  state.modelIds = [];
  state.vectorStores = [];
  state.vectorStoresLoaded = false;
  workspace.disabled = true;
  document.body.dataset.state = "locked";
  modelSelect.replaceChildren();
  vsSelect.replaceChildren();
  imgModel.replaceChildren();
  modelCount.textContent = "";
  applyModelRules();
  setInitStatus(message, kind);
}

async function init() {
  const key = keyInput.value.trim();
  if (!key) {
    lockWorkspace("Locked. Enter your OpenAI API key first.", "error");
    return;
  }

  lockWorkspace("Checking the key with OpenAI...");
  state.apiKey = key;
  setBusy(true);
  try {
    // A key is valid for INIT only if OpenAI accepts it and returns the model list.
    const data = await callApi("GET", "/models");
    if (!data || !Array.isArray(data.data) || data.data.length === 0) {
      throw new UserInputError("OpenAI accepted the key but returned no models, so there is nothing to select.");
    }
    state.modelIds = data.data.map(model => model.id).filter(id => typeof id === "string").sort();
    fillModelSelect();
    fillImageModelSelect();
    fillImageQuality();
    state.initialized = true;               // the gate: run() and the key-edit lock both check this
    workspace.disabled = false;
    document.body.dataset.state = "ready";
    setInitStatus("Ready. " + state.modelIds.length + " models available to this key.", "ready");
  } catch (error) {
    let message = explainError(error);
    if (error instanceof ApiError && error.status === 403) {
      message = "The key was not allowed to list models. INIT needs that. " +
                "If it is a restricted key, give it permission to read models.\n\n" + message;
    }
    lockWorkspace("Locked. " + message, "error");
  } finally {
    setBusy(false);
  }
}


/* ==================================================================
   5. Models and what each model supports
   ================================================================== */

function usableModelIds() {
  return showAllModels.checked
    ? state.modelIds
    : state.modelIds.filter(id => !NOT_A_TEXT_MODEL.test(id));
}

// Fills the dropdown from the API's list. The user must choose; nothing is pre-selected.
function fillModelSelect() {
  const previous = modelSelect.value;
  const ids = usableModelIds();
  modelSelect.replaceChildren();

  const placeholder = el("option", "", "Select a model");
  placeholder.value = "";
  modelSelect.append(placeholder);
  for (const id of ids) {
    const option = el("option", "", id);
    option.value = id;
    modelSelect.append(option);
  }
  if (ids.includes(previous)) modelSelect.value = previous;

  modelCount.textContent = ids.length + " of " + state.modelIds.length + " model IDs shown.";
  applyModelRules();
}

function ruleFor(modelId) {
  return MODEL_RULES.find(rule => rule.match(modelId)) || DEFAULT_RULE;
}

function setParamHint(hintEl, message) {
  hintEl.textContent = message;
}

// Enables only the controls documented for the selected model.
function applyModelRules() {
  const id = modelSelect.value;
  const rule = id ? ruleFor(id) : null;

  reasoningSelect.replaceChildren();
  const def = el("option", "", "Default (not sent)");
  def.value = "";
  reasoningSelect.append(def);

  if (!rule) {
    reasoningSelect.disabled = true;
    temperatureInput.disabled = true;
    topPInput.disabled = true;
    temperatureInput.value = "";
    topPInput.value = "";
    setParamHint(reasoningHint, "Select a model first.");
    setParamHint(temperatureHint, "Select a model first.");
    setParamHint(topPHint, "Select a model first.");
    capabilityNote.textContent = "";
    return;
  }

  if (rule.reasoning) {
    for (const level of rule.reasoning) {
      const option = el("option", "", level);
      option.value = level;
      reasoningSelect.append(option);
    }
    reasoningSelect.disabled = false;
    setParamHint(reasoningHint, "");
  } else {
    reasoningSelect.disabled = true;
    setParamHint(reasoningHint, "Not available for this model.");
  }

  temperatureInput.disabled = !rule.sampling;
  topPInput.disabled = !rule.sampling;
  if (!rule.sampling) {
    temperatureInput.value = "";
    topPInput.value = "";
  }
  const samplingHint = rule.sampling ? "Change this or Top P, not both." : "Not available for this model.";
  setParamHint(temperatureHint, samplingHint);
  setParamHint(topPHint, samplingHint);

  capabilityNote.textContent = rule.name + ". " + rule.source;
}


/* ==================================================================
   6. Image generation options
   ================================================================== */

function fillImageModelSelect() {
  imgModel.replaceChildren();
  const def = el("option", "", "Tool default (not sent)");
  def.value = "";
  imgModel.append(def);
  for (const id of IMAGE_TOOL_MODELS) {
    if (!state.modelIds.includes(id)) continue;
    const option = el("option", "", id);
    option.value = id;
    imgModel.append(option);
  }
}

function fillImageQuality() {
  const previous = imgQuality.value;
  const levels = ["", "auto", "low", "medium", "high"];
  if (IMAGE_QUALITY_EXTRA.test(imgModel.value)) levels.push("xhigh", "max");
  imgQuality.replaceChildren();
  for (const level of levels) {
    const option = el("option", "", level === "" ? "Default" : level);
    option.value = level;
    imgQuality.append(option);
  }
  if (levels.includes(previous)) imgQuality.value = previous;
}

function updateImageCompression() {
  const allowed = imgFormat.value === "jpeg" || imgFormat.value === "webp";
  imgCompression.disabled = !allowed;
  if (!allowed) imgCompression.value = "";
}


/* ==================================================================
   7. Attachments (sent with this one request)
   ================================================================== */

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function renderAttachments() {
  attachStatus.textContent = "";
  attachmentsList.replaceChildren();
  const groups = [["Image", state.images], ["Document", state.docs]];
  for (const [label, list] of groups) {
    list.forEach((file, index) => {
      const item = el("li", "", label + ": " + file.name + " (" + formatBytes(file.size) + ")");
      const remove = el("button", "", "x");
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove " + file.name);
      remove.addEventListener("click", () => { list.splice(index, 1); renderAttachments(); });
      item.append(remove);
      attachmentsList.append(item);
    });
  }
}

function addFiles(fileList, target, maxBytes, allowedTypes) {
  const problems = [];
  for (const file of Array.from(fileList)) {
    if (allowedTypes && !allowedTypes.includes(file.type)) {
      problems.push(file.name + ": unsupported image type (use PNG, JPEG, WEBP or non-animated GIF).");
    } else if (file.size > maxBytes) {
      problems.push(file.name + ": larger than " + formatBytes(maxBytes) + ".");
    } else {
      target.push(file);
    }
  }
  renderAttachments();
  attachStatus.textContent = problems.join(" ");
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new UserInputError("Could not read " + file.name + "."));
    reader.readAsDataURL(file);
  });
}

// Uploads a file to OpenAI's Files API and returns its id.
// expireSeconds is optional (documented range: 3600 to 2592000). Used as a safety net
// so a directly attached document disappears by itself even if the delete step fails.
async function uploadFile(file, purpose, expireSeconds) {
  const form = new FormData();
  form.append("purpose", purpose);
  if (expireSeconds) {
    form.append("expires_after[anchor]", "created_at");
    form.append("expires_after[seconds]", String(expireSeconds));
  }
  form.append("file", file, file.name);
  const data = await callApi("POST", "/files", { form });
  if (!data || !data.id) throw new UserInputError("OpenAI did not return a file id for " + file.name + ".");
  return data.id;
}


/* ==================================================================
   8. Vector stores (File Search)
   ================================================================== */

function logVs(message, isError) {
  const item = el("li", isError ? "is-error" : "", message);
  vsLog.append(item);
  return item;
}

function selectedStoreIds() {
  return Array.from(vsSelect.selectedOptions).map(option => option.value);
}

function renderVectorStores(keepSelected) {
  vsSelect.replaceChildren();
  for (const store of state.vectorStores) {
    const counts = store.file_counts && typeof store.file_counts.completed === "number"
      ? store.file_counts.completed + " files"
      : "files unknown";
    const option = el("option", "", (store.name || "(unnamed)") + "  " + store.id + "  " + counts);
    option.value = store.id;
    option.selected = keepSelected.includes(store.id);
    vsSelect.append(option);
  }
}

async function loadVectorStores(keepSelected = []) {
  setBusy(true);
  try {
    const data = await callApi("GET", "/vector_stores?limit=100");
    state.vectorStores = data && Array.isArray(data.data) ? data.data : [];
    state.vectorStoresLoaded = true;
    renderVectorStores(keepSelected);
    if (state.vectorStores.length === 0) logVs("No vector stores yet. Create one below.");
  } catch (error) {
    logVs(explainError(error), true);
  } finally {
    setBusy(false);
  }
}

async function createVectorStore() {
  setBusy(true);
  try {
    const name = vsName.value.trim();
    const created = await callApi("POST", "/vector_stores", { json: name ? { name } : {} });
    vsName.value = "";
    logVs("Created vector store " + created.id + ".");
    await loadVectorStoresAfter(created.id);
  } catch (error) {
    logVs(explainError(error), true);
  } finally {
    setBusy(false);
  }
}

async function loadVectorStoresAfter(newId) {
  const keep = selectedStoreIds().concat(newId ? [newId] : []);
  const data = await callApi("GET", "/vector_stores?limit=100");
  state.vectorStores = data && Array.isArray(data.data) ? data.data : [];
  state.vectorStoresLoaded = true;
  renderVectorStores(keep);
}

// Upload each file, attach it to the selected store, and wait until it is processed.
async function uploadToVectorStore() {
  const storeIds = selectedStoreIds();
  if (storeIds.length !== 1) {
    logVs("Select exactly one vector store to add documents to.", true);
    return;
  }
  const files = Array.from(vsFiles.files);
  if (files.length === 0) {
    logVs("Choose one or more documents first.", true);
    return;
  }

  setBusy(true);
  try {
    for (const file of files) {
      const line = logVs(file.name + ": uploading...");
      try {
        if (file.size > MAX_FILE_BYTES) throw new UserInputError("larger than " + formatBytes(MAX_FILE_BYTES));
        const fileId = await uploadFile(file, "assistants");
        let entry = await callApi("POST", "/vector_stores/" + storeIds[0] + "/files", { json: { file_id: fileId } });
        line.textContent = file.name + ": processing...";
        const started = Date.now();
        while (entry.status === "in_progress" && Date.now() - started < POLL_TIMEOUT_MS) {
          await sleep(POLL_INTERVAL_MS);
          entry = await callApi("GET", "/vector_stores/" + storeIds[0] + "/files/" + fileId);
        }
        if (entry.status === "completed") {
          line.textContent = file.name + ": ready.";
        } else if (entry.status === "in_progress") {
          line.textContent = file.name + ": still processing. Refresh the list later.";
        } else {
          const reason = entry.last_error && entry.last_error.message ? " " + entry.last_error.message : "";
          line.textContent = file.name + ": " + entry.status + "." + reason;
          line.className = "is-error";
        }
      } catch (error) {
        line.textContent = file.name + ": " + explainError(error);
        line.className = "is-error";
      }
    }
    vsFiles.value = "";
    await loadVectorStoresAfter(null);
  } catch (error) {
    logVs(explainError(error), true);
  } finally {
    setBusy(false);
  }
}


/* ==================================================================
   9. Building the request
   ================================================================== */

// Reads an optional number field. Empty means "do not send".
function readNumber(input, label, { min, max, integer }) {
  const raw = input.value.trim();
  if (raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
    const range = max === Infinity ? "at least " + min : "between " + min + " and " + max;
    throw new UserInputError(label + " must be " + (integer ? "a whole number " : "a number ") + range + ".");
  }
  return value;
}

function buildTools() {
  const tools = [];
  const include = [];
  let toolChoice;

  if (toolWeb.checked) {
    const tool = { type: "web_search" };
    if (webContext.value) tool.search_context_size = webContext.value;
    tools.push(tool);
    include.push("web_search_call.action.sources");
  }

  if (toolFiles.checked) {
    const ids = selectedStoreIds();
    if (ids.length === 0) {
      throw new UserInputError("File Search is ticked but no vector store is selected. Select one, or untick File Search.");
    }
    tools.push({ type: "file_search", vector_store_ids: ids });
  }

  if (toolImage.checked) {
    const tool = { type: "image_generation" };
    if (imgModel.value) tool.model = imgModel.value;
    if (imgSize.value) tool.size = imgSize.value;
    if (imgQuality.value) tool.quality = imgQuality.value;
    if (imgFormat.value) tool.output_format = imgFormat.value;
    if (imgBackground.value) tool.background = imgBackground.value;
    if (imgModeration.value) tool.moderation = imgModeration.value;
    const compression = readNumber(imgCompression, "Compression", { min: 0, max: 100, integer: true });
    if (compression !== undefined) tool.output_compression = compression;
    if (tool.background === "transparent" && tool.output_format === "jpeg") {
      throw new UserInputError("A transparent background needs the png or webp format, not jpeg.");
    }
    tools.push(tool);
    if (imgForce.checked) toolChoice = { type: "image_generation" };
  }

  return { tools, include, toolChoice };
}

// Turns the form into the JSON body for POST /v1/responses.
// Only documented parameters that apply to the chosen model are added.
// Documents are uploaded here, and their ids are recorded in `uploadedIds`.
async function buildRequestBody(uploadedIds) {
  const model = modelSelect.value;
  const prompt = promptInput.value.trim();
  if (!model) throw new UserInputError("Select a model.");
  if (!prompt) throw new UserInputError("Write a prompt.");
  const rule = ruleFor(model);

  const body = { model };

  const maxTokens = readNumber(maxOutput, "Max output tokens", { min: 16, max: Infinity, integer: true });
  if (maxTokens !== undefined) body.max_output_tokens = maxTokens;

  if (rule.reasoning && reasoningSelect.value && rule.reasoning.includes(reasoningSelect.value)) {
    body.reasoning = { effort: reasoningSelect.value };
  }
  if (rule.sampling) {
    const temperature = readNumber(temperatureInput, "Temperature", { min: 0, max: 2 });
    if (temperature !== undefined) body.temperature = temperature;
    const topP = readNumber(topPInput, "Top P", { min: 0, max: 1 });
    if (topP !== undefined) body.top_p = topP;
  }

  const instructions = instructionsInput.value.trim();
  if (instructions) body.instructions = instructions;

  const { tools, include, toolChoice } = buildTools();
  if (tools.length) body.tools = tools;
  if (include.length) body.include = include;
  if (toolChoice) body.tool_choice = toolChoice;

  if (state.images.length === 0 && state.docs.length === 0) {
    body.input = prompt;
  } else {
    const content = [{ type: "input_text", text: prompt }];
    for (const file of state.images) {
      content.push({ type: "input_image", image_url: await readAsDataUrl(file) });
    }
    for (const file of state.docs) {
      const id = await uploadFile(file, "user_data", deleteUploads.checked ? 3600 : 0);
      uploadedIds.push(id);
      content.push({ type: "input_file", file_id: id });
    }
    body.input = [{ role: "user", content }];
  }
  return body;
}

// A readable copy of the body for the "Request sent" box. Long data URLs are shortened.
function previewBody(body) {
  return JSON.stringify(body, (key, value) => {
    if (typeof value === "string" && value.startsWith("data:") && value.length > 80) {
      return value.slice(0, 40) + "... (" + value.length + " characters)";
    }
    return value;
  }, 2);
}


/* ==================================================================
   10. Markdown (built from DOM nodes, never from HTML strings)
   ================================================================== */

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*).*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const HR_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE_RE = /^\s{0,3}>/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const BLANK_RE = /^\s*$/;

const indentOf = line => line.length - line.trimStart().length;

// Links are only kept for http, https and mailto. Anything else becomes plain text.
function safeHref(raw) {
  try {
    const url = new URL(raw);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch (error) {
    return null;
  }
}

function makeLink(href, node) {
  const link = el("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  if (node) link.append(node);
  return link;
}

const PUNCT_RE = /[\p{P}\p{S}]/u;
const LINK_RE = /(!?)\[([^\]]+)\]\(\s*<?((?:[^()\s>]|\([^()\s]*\))+)>?(?:\s+"[^"]*")?\s*\)/y;
const AUTOLINK_RE = /<(https?:\/\/[^>\s]+)>/y;
const BARE_URL_RE = /https?:\/\/[^\s<>()\]]*[^\s<>()\].,;:!?"']/y;

function appendPlain(parent, text) {
  const parts = text.split("\n");
  parts.forEach((part, index) => {
    if (index > 0) parent.append(el("br"));
    if (part) parent.append(document.createTextNode(part));
  });
}

// Start and end of the text count as whitespace, as in CommonMark.
const isSpace = ch => ch === undefined || /\s/.test(ch);
const isPunct = ch => ch !== undefined && PUNCT_RE.test(ch);

function buildLink(match) {
  const href = safeHref(match[3]);
  if (match[1] === "!") {
    // Images are never loaded from the network: they become a link.
    const label = "[image: " + match[2] + "]";
    if (!href) return document.createTextNode(label);
    const link = makeLink(href);
    link.textContent = label;
    return link;
  }
  if (!href) {
    const plain = document.createDocumentFragment();
    renderInline(match[2], plain);
    return plain;
  }
  const link = makeLink(href);
  renderInline(match[2], link);
  return link;
}

// Step 1: split text into plain text, finished DOM nodes (code, links) and
// runs of * _ ~ that may become emphasis.
function tokenizeInline(text) {
  const nodes = [];
  let buffer = "";
  const flush = () => { if (buffer) { nodes.push({ t: "text", v: buffer }); buffer = ""; } };
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === "\\" && i + 1 < text.length && isPunct(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if (ch === "`") {
      let j = i;
      while (text[j] === "`") j++;
      const run = text.slice(i, j);
      let close = -1;
      for (let k = text.indexOf(run, j); k !== -1; k = text.indexOf(run, k + 1)) {
        if (text[k - 1] !== "`" && text[k + run.length] !== "`") { close = k; break; }
      }
      if (close === -1) { buffer += run; i = j; continue; }
      let code = text.slice(j, close).replace(/\n/g, " ");
      if (code.length > 1 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
      flush();
      nodes.push({ t: "dom", n: el("code", "", code) });
      i = close + run.length;
      continue;
    }

    if (ch === "[" || (ch === "!" && text[i + 1] === "[")) {
      LINK_RE.lastIndex = i;
      const m = LINK_RE.exec(text);
      if (m) { flush(); nodes.push({ t: "dom", n: buildLink(m) }); i += m[0].length; continue; }
    }

    if (ch === "<") {
      AUTOLINK_RE.lastIndex = i;
      const m = AUTOLINK_RE.exec(text);
      const href = m && safeHref(m[1]);
      if (href) { flush(); nodes.push({ t: "dom", n: makeLink(href, document.createTextNode(m[1])) }); i += m[0].length; continue; }
    }

    if (ch === "h" && text.startsWith("http", i) && !/[A-Za-z0-9]/.test(text[i - 1] || "")) {
      BARE_URL_RE.lastIndex = i;
      const m = BARE_URL_RE.exec(text);
      const href = m && safeHref(m[0]);
      if (href) { flush(); nodes.push({ t: "dom", n: makeLink(href, document.createTextNode(m[0])) }); i += m[0].length; continue; }
    }

    if (ch === "*" || ch === "_" || ch === "~") {
      let j = i;
      while (text[j] === ch) j++;
      const count = j - i;
      if (ch === "~" && count < 2) { buffer += text.slice(i, j); i = j; continue; }
      const prev = text[i - 1];
      const next = text[j];
      const left = !isSpace(next) && (!isPunct(next) || isSpace(prev) || isPunct(prev));
      const right = !isSpace(prev) && (!isPunct(prev) || isSpace(next) || isPunct(next));
      let open = left;
      let close = right;
      if (ch === "_") {                       // underscores never open or close inside a word
        open = left && (!right || isPunct(prev));
        close = right && (!left || isPunct(next));
      }
      flush();
      nodes.push({ t: "delim", ch, count, orig: count, open, close });
      i = j;
      continue;
    }

    buffer += ch;
    i++;
  }
  flush();
  return nodes;
}

// Step 2: match opening and closing runs (the CommonMark delimiter algorithm).
// Runs that never match stay as literal characters.
function processEmphasis(nodes) {
  for (let ci = 0; ci < nodes.length; ci++) {
    const closer = nodes[ci];
    if (closer.t !== "delim" || !closer.close || closer.count === 0) continue;

    let found = -1;
    for (let oi = ci - 1; oi >= 0; oi--) {
      const opener = nodes[oi];
      if (opener.t !== "delim" || opener.ch !== closer.ch || !opener.open || opener.count === 0) continue;
      if (closer.ch === "~") {
        if (opener.count < 2 || closer.count < 2) continue;
      } else if ((opener.close || closer.open) && (opener.orig + closer.orig) % 3 === 0 &&
                 !(opener.orig % 3 === 0 && closer.orig % 3 === 0)) {
        continue;
      }
      found = oi;
      break;
    }
    if (found < 0) continue;

    const opener = nodes[found];
    const use = closer.ch === "~" ? 2 : (opener.count >= 2 && closer.count >= 2 ? 2 : 1);
    const kind = closer.ch === "~" ? "del" : (use === 2 ? "strong" : "em");
    const inner = nodes.splice(found + 1, ci - found - 1);
    const children = inner.map(n => n.t === "delim" ? { t: "text", v: n.ch.repeat(n.count) } : n);
    opener.count -= use;
    closer.count -= use;
    nodes.splice(found + 1, 0, { t: kind, children });
    ci = found + 1;                           // the closer is now at found + 2 and is checked again
  }
}

// Step 3: turn the node list into DOM elements.
function emitInline(nodes, parent) {
  for (const node of nodes) {
    if (node.t === "text") appendPlain(parent, node.v);
    else if (node.t === "dom") parent.append(node.n);
    else if (node.t === "delim") { if (node.count > 0) appendPlain(parent, node.ch.repeat(node.count)); }
    else {
      const wrapper = el(node.t);
      emitInline(node.children, wrapper);
      parent.append(wrapper);
    }
  }
}

function renderInline(text, parent) {
  const nodes = tokenizeInline(text);
  processEmphasis(nodes);
  emitInline(nodes, parent);
}

function startsBlock(line) {
  return FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line) || LIST_RE.test(line);
}

function isTableStart(lines, i) {
  return i + 1 < lines.length && lines[i].includes("|") && lines[i + 1].includes("|") && TABLE_SEP_RE.test(lines[i + 1]);
}

function splitRow(line) {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && text[i + 1] === "|") { current += "|"; i++; }
    else if (text[i] === "|") { cells.push(current.trim()); current = ""; }
    else current += text[i];
  }
  cells.push(current.trim());
  return cells;
}

function renderTable(lines, start, parent) {
  const head = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map(cell => {
    if (cell.startsWith(":") && cell.endsWith(":")) return "al-center";
    if (cell.endsWith(":")) return "al-right";
    return "";
  });
  const table = el("table");
  const headRow = el("tr");
  head.forEach((cell, index) => {
    const th = el("th", aligns[index] || "");
    renderInline(cell, th);
    headRow.append(th);
  });
  const thead = el("thead");
  thead.append(headRow);
  table.append(thead);

  const bodyEl = el("tbody");
  let i = start + 2;
  while (i < lines.length && !BLANK_RE.test(lines[i]) && lines[i].includes("|")) {
    const row = el("tr");
    const cells = splitRow(lines[i]);
    head.forEach((_, index) => {
      const td = el("td", aligns[index] || "");
      renderInline(cells[index] || "", td);
      row.append(td);
    });
    bodyEl.append(row);
    i++;
  }
  table.append(bodyEl);
  const wrap = el("div", "table-wrap");
  wrap.append(table);
  parent.append(wrap);
  return i;
}

function renderList(lines, start, parent) {
  const first = lines[start].match(LIST_RE);
  const baseIndent = first[1].length;
  const ordered = /^\d/.test(first[2]);
  const list = el(ordered ? "ol" : "ul");
  if (ordered) {
    const number = parseInt(first[2], 10);
    if (number > 1) list.setAttribute("start", String(number));
  }

  let i = start;
  while (i < lines.length) {
    const m = lines[i].match(LIST_RE);
    if (!m || m[1].length >= baseIndent + 2 || m[1].length < baseIndent || /^\d/.test(m[2]) !== ordered) break;

    const itemLines = [m[3]];
    let loose = false;
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (BLANK_RE.test(line)) {
        let j = i;
        while (j < lines.length && BLANK_RE.test(lines[j])) j++;
        if (j < lines.length && indentOf(lines[j]) >= baseIndent + 2) {
          for (let k = i; k < j; k++) itemLines.push("");
          loose = true;
          i = j;
          continue;
        }
        break;
      }
      if (indentOf(line) >= baseIndent + 2) {
        itemLines.push(line.slice(Math.min(indentOf(line), baseIndent + 2)));
        i++;
      } else if (LIST_RE.test(line) || startsBlock(line)) {
        break;
      } else {
        itemLines.push(line.trim());          // lazy continuation of the item's text
        i++;
      }
    }

    const item = el("li");
    const holder = el("div");
    renderBlocks(itemLines, holder);
    if (!loose) {
      for (const child of Array.from(holder.children)) {
        if (child.tagName === "P") {
          while (child.firstChild) holder.insertBefore(child.firstChild, child);
          holder.removeChild(child);
        }
      }
    }
    while (holder.firstChild) item.append(holder.firstChild);
    list.append(item);
  }
  parent.append(list);
  return i;
}

function renderBlocks(lines, parent) {
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (BLANK_RE.test(line)) { i++; continue; }

    let m = line.match(FENCE_RE);
    if (m) {
      const fence = m[1];
      const closing = new RegExp("^\\s{0,3}" + fence[0] + "{" + fence.length + ",}\\s*$");
      const body = [];
      i++;
      while (i < lines.length && !closing.test(lines[i])) { body.push(lines[i]); i++; }
      i++;
      const pre = el("pre");
      const code = el("code", m[2] ? "language-" + m[2].replace(/[^\w-]/g, "") : "");
      code.textContent = body.join("\n");
      pre.append(code);
      parent.append(pre);
      continue;
    }

    m = line.match(HEADING_RE);
    if (m) {
      const heading = el("h" + m[1].length);
      renderInline(m[2], heading);
      parent.append(heading);
      i++;
      continue;
    }

    if (HR_RE.test(line)) { parent.append(el("hr")); i++; continue; }

    if (isTableStart(lines, i)) { i = renderTable(lines, i, parent); continue; }

    if (QUOTE_RE.test(line)) {
      const inner = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        inner.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
        i++;
      }
      const quote = el("blockquote");
      renderBlocks(inner, quote);
      parent.append(quote);
      continue;
    }

    if (LIST_RE.test(line)) { i = renderList(lines, i, parent); continue; }

    const paragraph = [line];
    i++;
    while (i < lines.length && !BLANK_RE.test(lines[i]) && !startsBlock(lines[i]) && !isTableStart(lines, i)) {
      paragraph.push(lines[i]);
      i++;
    }
    const p = el("p");
    renderInline(paragraph.map(text => text.trim()).join("\n"), p);
    parent.append(p);
  }
}

function renderMarkdown(source, parent) {
  const lines = String(source).replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  renderBlocks(lines, parent);
}


/* ==================================================================
   11. Showing the response
   ================================================================== */

let downloadUrls = [];

// kind is "empty", "loading", "error", or nothing for a normal answer.
function setResponse(text, kind) {
  for (const url of downloadUrls) URL.revokeObjectURL(url);
  downloadUrls = [];
  responseBox.replaceChildren();
  responseBox.className = "response" + (kind ? " is-" + kind : "");
  responseBox.textContent = text;
}

function showNotice(text) {
  responseBox.append(el("div", "notice", text));
}

const IMAGE_MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Reads the "output" array of a Responses API answer.
function parseResponse(data) {
  const result = {
    texts: [], images: [], links: [], files: [], notes: [],
    status: data.status || "", incomplete: "", error: null,
    model: data.model || "", usage: data.usage || null,
  };
  if (data.error) result.error = data.error.message || "The response reports an error.";
  if (data.incomplete_details && data.incomplete_details.reason) result.incomplete = data.incomplete_details.reason;

  const addLink = (url, title) => {
    if (url && !result.links.some(link => link.url === url)) result.links.push({ url, title: title || url });
  };

  for (const item of data.output || []) {
    if (item.type === "message") {
      for (const part of item.content || []) {
        if (part.type === "output_text") {
          result.texts.push(part.text || "");
          for (const note of part.annotations || []) {
            if (note.type === "url_citation") addLink(note.url, note.title);
            if (note.type === "file_citation" && note.filename && !result.files.includes(note.filename)) {
              result.files.push(note.filename);
            }
          }
        } else if (part.type === "refusal") {
          result.texts.push(part.refusal || "The model refused this request.");
        }
      }
    } else if (item.type === "image_generation_call") {
      if (item.result) {
        result.images.push({
          base64: item.result, format: item.output_format || "png", size: item.size || "",
          quality: item.quality || "", revised: item.revised_prompt || "",
        });
      } else {
        result.notes.push("Image generation returned no image (status: " + (item.status || "unknown") + ").");
      }
    } else if (item.type === "web_search_call") {
      result.notes.push("Web search ran.");
      const sources = item.action && item.action.sources;
      for (const source of sources || []) addLink(source.url);
    } else if (item.type === "file_search_call") {
      const queries = (item.queries || []).join("; ");
      result.notes.push("File Search ran" + (queries ? ": " + queries : "."));
    }
  }
  return result;
}

function renderImages(images) {
  const wrap = el("div", "gen-images");
  for (const image of images) {
    if (!/^[A-Za-z0-9+/=\s]+$/.test(image.base64)) continue;
    const mime = IMAGE_MIME[image.format] || "image/png";
    const figure = el("figure", "gen-image");
    const img = el("img");
    img.alt = image.revised || "Generated image";
    img.src = "data:" + mime + ";base64," + image.base64;
    figure.append(img);

    const caption = el("figcaption");
    const details = [image.format, image.size, image.quality && "quality " + image.quality].filter(Boolean).join(", ");
    caption.append(document.createTextNode(details + " "));
    try {
      const url = URL.createObjectURL(base64ToBlob(image.base64.replace(/\s/g, ""), mime));
      downloadUrls.push(url);
      const link = el("a", "", "Download");
      link.href = url;
      link.download = "generated-image." + (image.format === "jpeg" ? "jpg" : image.format);
      caption.append(link);
    } catch (error) {
      // No download link if the browser cannot build one.
    }
    figure.append(caption);
    wrap.append(figure);
  }
  return wrap;
}

function renderSources(result) {
  if (result.links.length === 0 && result.files.length === 0) return null;
  const box = el("div", "sources");
  box.append(el("h3", "", "Sources"));
  const list = el("ul");
  for (const source of result.links) {
    const item = el("li");
    const href = safeHref(source.url);
    if (href) item.append(makeLink(href, document.createTextNode(source.title)));
    else item.append(document.createTextNode(source.title));
    list.append(item);
  }
  for (const name of result.files) list.append(el("li", "", "File: " + name));
  box.append(list);
  return box;
}

function setUsage(rows) {
  usageList.replaceChildren();
  for (const [label, value] of rows) {
    const wrap = el("div");
    wrap.append(el("dt", "", label), el("dd", "", value));
    usageList.append(wrap);
  }
}

function formatNumber(value) {
  return typeof value === "number" ? value.toLocaleString("en-US") : "-";
}

// Shows only what the response's usage object reports. Nothing is estimated.
function showUsage(result) {
  const usage = result.usage;
  const rows = [];
  if (usage) {
    rows.push(["Input", formatNumber(usage.input_tokens)]);
    const cached = usage.input_tokens_details && usage.input_tokens_details.cached_tokens;
    if (typeof cached === "number") rows.push(["of which cached", formatNumber(cached)]);
    rows.push(["Output", formatNumber(usage.output_tokens)]);
    const reasoning = usage.output_tokens_details && usage.output_tokens_details.reasoning_tokens;
    if (typeof reasoning === "number") rows.push(["of which reasoning", formatNumber(reasoning)]);
    rows.push(["Total", formatNumber(usage.total_tokens)]);
  }
  setUsage(rows);

  const lines = [];
  lines.push("Model reported by the API: " + (result.model || "not reported") + ".");
  if (result.status) lines.push("Status: " + result.status + ".");
  if (!usage) lines.push("The response contained no usage information.");
  lines.push("Only token counts are shown. Other charges, such as per-call tool fees, are not.");
  usageExtra.textContent = lines.join(" ");
}

function renderResult(data) {
  const result = parseResponse(data);
  setResponse("", "");

  if (result.error) {
    responseBox.append(el("div", "notice", "OpenAI reported an error: " + hideKey(result.error, state.apiKey)));
  }

  const text = result.texts.join("\n\n").trim();
  if (text) {
    const md = el("div", "md");
    renderMarkdown(text, md);
    responseBox.append(md);
  }
  if (result.images.length) responseBox.append(renderImages(result.images));

  if (!text && result.images.length === 0 && !result.error) {
    responseBox.append(el("p", "", "The model returned no text or image."));
    responseBox.classList.add("is-empty");
  }

  const sources = renderSources(result);
  if (sources) responseBox.append(sources);
  for (const note of result.notes) showNotice(note);
  if (result.incomplete) showNotice("The response is incomplete (reason: " + result.incomplete + ").");

  showUsage(result);
}


/* ==================================================================
   12. RUN
   ================================================================== */

async function deleteUploads_(ids) {
  const problems = [];
  for (const id of ids) {
    try {
      await callApi("DELETE", "/files/" + id);
    } catch (error) {
      problems.push("Could not delete uploaded file " + id + ": " + explainError(error));
    }
  }
  return problems;
}

async function run() {
  if (!state.initialized || state.busy > 0) return;

  setBusy(true);
  runButton.disabled = true;
  runButton.textContent = "Running...";
  setResponse("Waiting for the response...", "loading");
  setUsage([]);
  usageExtra.textContent = "";
  const uploadedIds = [];
  let cleanupProblems = [];

  try {
    const body = await buildRequestBody(uploadedIds);
    requestJson.textContent = previewBody(body);
    const data = await callApi("POST", "/responses", { json: body });
    if (!data) throw new UserInputError("OpenAI sent an answer this page could not read.");
    renderResult(data);
  } catch (error) {
    setResponse(explainError(error), "error");
  } finally {
    if (uploadedIds.length && deleteUploads.checked) cleanupProblems = await deleteUploads_(uploadedIds);
    for (const problem of cleanupProblems) showNotice(problem);
    runButton.disabled = false;
    runButton.textContent = "RUN";
    setBusy(false);
  }
}


/* ==================================================================
   13. Start
   ================================================================== */

initButton.addEventListener("click", init);
keyInput.addEventListener("keydown", event => { if (event.key === "Enter") init(); });
// Editing the key invalidates the INIT result, so the workspace locks again.
keyInput.addEventListener("input", () => {
  if (state.initialized) lockWorkspace("Locked. The key changed. Press INIT again.");
});

modelSelect.addEventListener("change", applyModelRules);
showAllModels.addEventListener("change", fillModelSelect);

$("add-images").addEventListener("click", () => imageInput.click());
$("add-docs").addEventListener("click", () => docInput.click());
imageInput.addEventListener("change", () => {
  addFiles(imageInput.files, state.images, MAX_IMAGE_BYTES, ["image/png", "image/jpeg", "image/webp", "image/gif"]);
  imageInput.value = "";
});
docInput.addEventListener("change", () => {
  addFiles(docInput.files, state.docs, MAX_FILE_BYTES, null);
  docInput.value = "";
});

toolWeb.addEventListener("change", () => { webOpts.hidden = !toolWeb.checked; });
toolFiles.addEventListener("change", () => {
  filesOpts.hidden = !toolFiles.checked;
  if (toolFiles.checked && !state.vectorStoresLoaded) loadVectorStores();
});
toolImage.addEventListener("change", () => { imageOpts.hidden = !toolImage.checked; });
$("vs-refresh").addEventListener("click", () => loadVectorStores(selectedStoreIds()));
$("vs-create").addEventListener("click", createVectorStore);
$("vs-upload").addEventListener("click", uploadToVectorStore);
imgModel.addEventListener("change", fillImageQuality);
imgFormat.addEventListener("change", updateImageCompression);

runButton.addEventListener("click", run);

lockWorkspace("Locked. Enter your OpenAI API key and press INIT.");
