import { clearModelCache, loadModelBytes } from './model-cache.js';

// ─── DOM refs ────────────────────────────────────────────────────────────────

const outputEl     = document.getElementById('output');
const emptyState   = document.getElementById('empty-state');
const runBtn       = document.getElementById('run-btn');
const stopBtn      = document.getElementById('stop-btn');
const cfgBtn       = document.getElementById('cfg-btn');
const cfgPanel     = document.getElementById('cfg-panel');
const statusDot    = document.getElementById('status-dot');
const statusText   = document.getElementById('status-text');
const diagEl       = document.getElementById('diag');
const copyUrlBtn   = document.getElementById('copy-url-btn');
const clearBtn     = document.getElementById('clear-output-btn');
const clearModelCacheBtn = document.getElementById('clear-model-cache-btn');

const fields = {
  prompt:      document.getElementById('field-prompt'),
  maxTokens:   document.getElementById('field-maxTokens'),
  temp:        document.getElementById('field-temp'),
  version:     document.getElementById('field-version'),
  target:      document.getElementById('field-target'),
  backend:     document.getElementById('field-backend'),
  modelId:     document.getElementById('field-modelId'),
  modelUrl:    document.getElementById('field-modelUrl'),
  contextSize: document.getElementById('field-contextSize'),
  seed:        document.getElementById('field-seed'),
  commit:      document.getElementById('field-commit'),
};

const stageNodes = new Map(
  [...document.querySelectorAll('[data-stage]')].map((n) => [n.dataset.stage, n]),
);

const metricEls = {
  startup: document.getElementById('metric-startup'),
  dl:      document.getElementById('metric-dl'),
  load:    document.getElementById('metric-load'),
  tps:     document.getElementById('metric-tps'),
  tokens:  document.getElementById('metric-tokens'),
  decode:  document.getElementById('metric-decode'),
};

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_MODEL_URL      = 'https://huggingface.co/lmstudio-community/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf?download=1';
const DEFAULT_CPU_VERSION    = 'local-cpu';
const DEFAULT_WEBGPU_VERSION = 'local-webgpu';
const STAGES                 = ['bootstrap', 'download', 'load', 'decode', 'complete'];

// ─── State ────────────────────────────────────────────────────────────────────

let worker  = null;
let running = false;
const diagLines = [];

// ─── Init ─────────────────────────────────────────────────────────────────────

initUi();

// ─── Event wiring ────────────────────────────────────────────────────────────

cfgBtn.addEventListener('click', () => {
  const open = cfgPanel.classList.toggle('open');
  cfgBtn.setAttribute('aria-expanded', String(open));
});

fields.backend.addEventListener('change', () => {
  if (isDefaultVersion(fields.version.value.trim())) {
    fields.version.value = defaultVersion(fields.backend.value);
  }
});

runBtn.addEventListener('click', () => {
  syncUrl();
  void runBench();
});

stopBtn.addEventListener('click', () => {
  worker?.postMessage({ type: 'cancel', id: 'cancel' });
});

copyUrlBtn?.addEventListener('click', async () => {
  syncUrl();
  try { await navigator.clipboard.writeText(window.location.href); } catch { /* noop */ }
});

clearBtn?.addEventListener('click', () => {
  clearOutput();
});

clearModelCacheBtn?.addEventListener('click', async () => {
  try {
    const result = await clearModelCache();
    if (!result.supported) {
      appendDiag('model cache unavailable in this browser');
      return;
    }
    appendDiag(result.deleted ? 'model cache cleared' : 'model cache already empty');
  } catch (error) {
    appendDiag(`model cache clear failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

// Auto-resize prompt textarea
fields.prompt.addEventListener('input', () => {
  fields.prompt.style.height = 'auto';
  fields.prompt.style.height = Math.min(fields.prompt.scrollHeight, 200) + 'px';
});

// Cmd/Ctrl+Enter to run
fields.prompt.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    if (!running) { syncUrl(); void runBench(); }
  }
});

// ─── Main bench loop ──────────────────────────────────────────────────────────

async function runBench() {
  if (running) return;
  running = true;
  setRunState('running');
  resetStages();
  resetMetrics();

  const cfg = readConfig();
  let w = null;

  // Remove empty state on first run
  emptyState?.remove();

  // Status lines are injected into output and updated in place
  let statusBlock = null;
  const setStatus = (html) => {
    if (!statusBlock) {
      statusBlock = document.createElement('div');
      statusBlock.className = 'status-line';
      outputEl.appendChild(statusBlock);
    }
    statusBlock.innerHTML = html;
    scrollOutput();
  };

  try {
    resetDiag();
    appendDiag(`browser=${navigator.userAgent.slice(0, 80)}`);
    appendDiag(`navigator.gpu=${Boolean(navigator.gpu)}`);
    appendDiag(`WebAssembly.promising=${typeof globalThis.WebAssembly?.promising === 'function'}`);

    if (cfg.backend === 'webgpu' && !navigator.gpu) {
      throw new Error('navigator.gpu unavailable — use Chrome with --enable-unsafe-webgpu');
    }

    // ── bootstrap ──────────────────────────────────────────────────────────
    setStage('bootstrap', 'active');
    setStatus(`Resolving <b>${cfg.version}/${cfg.target}</b>…`);

    const manifest = await fetchJson(`/wasm-build/dist/${cfg.version}/manifest.json`);
    const tgt = manifest.targets?.[cfg.target];
    if (!tgt) throw new Error(`Target "${cfg.target}" not found in manifest`);

    appendDiag(`artifact=${cfg.version}/${cfg.target}`);
    appendDiag(`toggles=${JSON.stringify(manifest.featureToggles ?? {})}`);

    const resolved = resolveTarget(cfg, manifest, tgt);
    appendDiag(`modulePath=${resolved.modulePath}`);

    // Auto-correct backend if artifact overrides it
    if (cfg.backend !== resolved.backend) {
      setStatus(`⚠ Switching backend: ${cfg.backend} → ${resolved.backend}`);
      fields.backend.value = resolved.backend;
      cfg.backend = resolved.backend;
    }

    const t0 = performance.now();
    w = new Worker('/bench/browser/bench-worker.js', { type: 'module', name: 'wasml-bench' });
    worker = w;

    await rpcOnce(w, {
      type: 'init', id: 'init',
      modulePath: resolved.modulePath,
      wasmPath:   resolved.wasmPath,
      backend:    cfg.backend,
      contextSize: cfg.contextSize,
    }, 'ready');

    const startupMs = performance.now() - t0;
    setMetric('startup', fmtMs(startupMs));
    setStage('bootstrap', 'done');

    // ── download ────────────────────────────────────────────────────────────
    setStage('download', 'active');
    const dlT0 = performance.now();
    const modelLoad = await loadModelBytes(cfg.modelUrl, cfg.modelId, (received, total, meta) => {
      if (meta?.source === 'cache') {
        setStatus(`↓ Using cached <b>${cfg.modelId}</b>… ${fmtBytes(total)} ready`);
        return;
      }
      const pct = total ? ` (${Math.round(received / total * 100)}%)` : '';
      const bar = total ? progressBar(received / total) : '';
      setStatus(`↓ Downloading <b>${cfg.modelId}</b>… ${fmtBytes(received)}/${fmtBytes(total)}${pct}${bar}`);
    });
    const modelBytes = modelLoad.bytes;
    const dlMs = performance.now() - dlT0;
    appendDiag(`model cache ${modelLoad.source === 'cache' ? 'hit' : 'miss'} (${fmtBytes(modelLoad.totalBytes)})`);
    if (modelLoad.source === 'network') {
      if (modelLoad.cacheWrite === 'stored') {
        appendDiag('model cache stored for reuse');
      } else if (modelLoad.cacheWrite === 'failed') {
        appendDiag(`model cache store failed: ${modelLoad.cacheWriteError}`);
      } else if (modelLoad.cacheWrite === 'unavailable') {
        appendDiag('model cache unavailable in this browser');
      }
    }
    setMetric('dl', fmtMs(dlMs));
    setStage('download', 'done');

    // ── load ────────────────────────────────────────────────────────────────
    setStage('load', 'active');
    setStatus(`⤒ Loading ${fmtBytes(modelBytes.byteLength)} into runtime…`);
    const loadT0 = performance.now();
    await rpcOnce(w, { type: 'load', id: 'load', bytes: modelBytes.buffer }, 'loaded', [modelBytes.buffer]);
    const loadMs = performance.now() - loadT0;
    setMetric('load', fmtMs(loadMs));
    setStage('load', 'done');

    // Remove the status line — generation output follows
    if (statusBlock) { statusBlock.remove(); statusBlock = null; }

    // ── decode (streaming) ──────────────────────────────────────────────────
    setStage('decode', 'active');

    const runBlock = appendRunBlock(cfg.prompt);
    scrollOutput();

    const decT0 = performance.now();
    let tokenCount = 0;
    let tpsTimer = null;

    // Live tok/s update every 400ms during generation
    tpsTimer = globalThis.setInterval(() => {
      const elapsed = (performance.now() - decT0) / 1000;
      if (tokenCount > 0 && elapsed > 0) {
        const liveTps = tokenCount / elapsed;
        setMetricLive('tps', liveTps.toFixed(1));
      }
    }, 400);

    const { totalTokens, memoryBytes } = await rpcStream(
      w,
      {
        type: 'infer', id: 'infer',
        prompt:    cfg.prompt,
        maxTokens: cfg.maxTokens,
        sampling: {
          temperature: cfg.temperature,
          topK:  cfg.temperature === 0 ? 1   : 40,
          topP:  cfg.temperature === 0 ? 1.0 : 0.95,
          seed:  cfg.seed,
        },
      },
      (tokenText) => {
        tokenCount += 1;
        runBlock.appendToken(tokenText);
        setMetric('tokens', String(tokenCount));
        scrollOutput();
      },
    );

    globalThis.clearInterval(tpsTimer);
    const decMs = performance.now() - decT0;
    const tps = totalTokens > 0 ? totalTokens / (decMs / 1000) : 0;

    runBlock.complete({
      tps, tokens: totalTokens, decMs,
      backend: cfg.backend, memoryBytes,
    });

    setMetric('tps',    tps.toFixed(1));
    setMetric('tokens', String(totalTokens));
    setMetric('decode', fmtMs(decMs));
    setMetricNormal('tps');

    setStage('decode', 'done');
    setStage('complete', 'done');
    setRunState('done');
    scrollOutput();

    // Expose result for Puppeteer automation
    window.__benchResult = buildSample(cfg, manifest, tgt, {
      startupMs, dlMs, loadMs, decMs, tps,
      totalTokens, memoryBytes,
      outputText: runBlock.getText(),
    });
    return window.__benchResult;

  } catch (err) {
    if (statusBlock) { statusBlock.remove(); }
    setActiveStageError();
    appendDiag(fmtErrDiag(err));
    appendRunError(fmtErrOutput(err));
    setRunState('error');
    throw err;
  } finally {
    running = false;
    worker = null;
    if (w) {
      w.postMessage({ type: 'destroy', id: 'destroy' });
      setTimeout(() => w.terminate(), 1200);
    }
  }
}

// Puppeteer entry point
window.runWasmlBench = function runWasmlBench(input) {
  if (input?.config?.artifact) {
    fields.version.value = normalizeVersion(input.config.artifact.version ?? DEFAULT_WEBGPU_VERSION);
    fields.target.value  = input.config.artifact.target ?? 'core';
    fields.backend.value = input.config.artifact.backend ?? 'webgpu';
  }
  if (input?.config?.model) {
    fields.modelId.value  = input.config.model.id ?? '';
    fields.modelUrl.value = input.config.model.sourceUrl ?? DEFAULT_MODEL_URL;
  }
  if (input?.config?.prompt)      fields.prompt.value    = input.config.prompt;
  if (input?.config?.maxTokens)   fields.maxTokens.value = String(input.config.maxTokens);
  if (input?.config?.contextSize) fields.contextSize.value = String(input.config.contextSize);
  if (input?.commit)              fields.commit.value    = input.commit;
  syncUrl();
  return runBench();
};

// ─── RPC helpers ─────────────────────────────────────────────────────────────

/** Wait for a single response of the given type */
function rpcOnce(w, msg, expectedType, transfer = []) {
  return new Promise((resolve, reject) => {
    const h = (ev) => {
      const d = ev.data;
      if (d.type === 'diag') { appendDiag(fmtDiagMsg(d)); return; }
      if (d.id !== msg.id) return;
      w.removeEventListener('message', h);
      if (d.type === 'error') reject(buildStructuredError(d));
      else if (d.type === expectedType) resolve(d);
      else reject(new Error(`unexpected worker message: ${d.type}`));
    };
    w.addEventListener('message', h);
    w.postMessage(msg, transfer);
  });
}

/** Stream tokens until 'done'; onToken called per token message */
function rpcStream(w, msg, onToken) {
  return new Promise((resolve, reject) => {
    const h = (ev) => {
      const d = ev.data;
      if (d.type === 'diag') { appendDiag(fmtDiagMsg(d)); return; }
      if (d.id !== msg.id) return;
      if (d.type === 'token') {
        if (d.text) onToken(d.text);
        return;
      }
      w.removeEventListener('message', h);
      if (d.type === 'error') reject(buildStructuredError(d));
      else if (d.type === 'done') resolve({ totalTokens: d.tokenCount ?? 0, memoryBytes: d.memoryBytes ?? 0 });
      else reject(new Error(`unexpected worker message: ${d.type}`));
    };
    w.addEventListener('message', h);
    w.postMessage(msg);
  });
}

// ─── Output helpers ───────────────────────────────────────────────────────────

function appendRunBlock(prompt) {
  const block = document.createElement('div');
  block.className = 'run-block';

  const promptEl = document.createElement('div');
  promptEl.className = 'run-prompt';
  promptEl.textContent = prompt;

  const responseEl = document.createElement('div');
  responseEl.className = 'run-response';

  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  responseEl.appendChild(cursor);

  const statsEl = document.createElement('div');
  statsEl.className = 'run-stats';

  block.appendChild(promptEl);
  block.appendChild(responseEl);
  block.appendChild(statsEl);
  outputEl.appendChild(block);

  let accumulated = '';

  return {
    appendToken(text) {
      accumulated += text;
      cursor.remove();
      responseEl.appendChild(document.createTextNode(text));
      responseEl.appendChild(cursor);
    },
    complete({ tps, tokens, decMs, backend, memoryBytes }) {
      cursor.remove();
      const mem = memoryBytes > 0 ? ` · ${fmtBytes(memoryBytes)} heap` : '';
      statsEl.innerHTML =
        `<span class="stat stat-hi">${tps.toFixed(1)} tok/s</span>` +
        `<span class="stat">${tokens} tokens</span>` +
        `<span class="stat">${fmtMs(decMs)}</span>` +
        `<span class="stat">${backend}</span>` +
        (mem ? `<span class="stat">${mem}</span>` : '');
    },
    getText() { return accumulated; },
  };
}

function appendRunError(message) {
  const el = document.createElement('div');
  el.className = 'run-block';
  el.style.borderLeftColor = 'var(--danger)';
  el.innerHTML = `<div class="run-response" style="color:var(--danger)">${escHtml(message)}</div>`;
  outputEl.appendChild(el);
  scrollOutput();
}

function scrollOutput() {
  // Use rAF to avoid layout thrash during streaming
  globalThis.requestAnimationFrame(() => {
    outputEl.scrollTop = outputEl.scrollHeight;
  });
}

function clearOutput() {
  outputEl.innerHTML = '';
  if (!emptyState?.isConnected) {
    const es = document.createElement('div');
    es.className = 'empty-state';
    es.id = 'empty-state';
    es.innerHTML =
      '<span class="icon">⌗</span>' +
      '<span>Type a prompt below and press <kbd>⌘↵</kbd> to run</span>' +
      '<span class="hint">First run downloads the model — later runs can reuse the browser cache</span>';
    outputEl.appendChild(es);
  }
  resetStages();
  resetMetrics();
  resetDiag();
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

function progressBar(ratio) {
  return `<span class="progress-bar"><span class="progress-fill" style="width:${(ratio * 100).toFixed(0)}%"></span></span>`;
}

// ─── Config ───────────────────────────────────────────────────────────────────

function initUi() {
  const p = new URLSearchParams(window.location.search);
  const backend = p.get('backend') ?? defaultBackend();
  fields.backend.value  = backend;
  fields.version.value  = normalizeVersion(p.get('version')) || defaultVersion(backend);
  fields.target.value   = p.get('target') ?? 'core';
  fields.commit.value   = p.get('commit') ?? 'browser-manual';
  fields.maxTokens.value = p.get('maxTokens') ?? '48';
  fields.temp.value     = p.get('temp') ?? '0.0';
  fields.modelId.value  = p.get('modelId') ?? 'qwen3.5-0.8b-q4_k_m';
  fields.modelUrl.value = p.get('modelUrl') ?? DEFAULT_MODEL_URL;
  fields.contextSize.value = p.get('contextSize') ?? '2048';
  fields.seed.value     = p.get('seed') ?? '0';
  fields.prompt.value   = p.get('prompt') ?? 'Write one concise sentence about WebGPU benchmarking in browsers.';
}

function readConfig() {
  const backend = fields.backend.value;
  return {
    version:     normalizeVersion(fields.version.value.trim()) || defaultVersion(backend),
    target:      fields.target.value,
    backend,
    commit:      fields.commit.value.trim() || 'browser-manual',
    maxTokens:   Math.max(1, Number(fields.maxTokens.value) || 48),
    temperature: Math.max(0, Math.min(2, Number(fields.temp.value) || 0)),
    contextSize: Math.max(256, Number(fields.contextSize.value) || 2048),
    seed:        Number(fields.seed.value) || 0,
    modelId:     fields.modelId.value.trim() || 'qwen3.5-0.8b-q4_k_m',
    modelUrl:    fields.modelUrl.value.trim() || DEFAULT_MODEL_URL,
    prompt:      fields.prompt.value.trim() || 'Hello',
  };
}

function syncUrl() {
  const c = readConfig();
  const p = new URLSearchParams({
    version: c.version, target: c.target, backend: c.backend,
    commit: c.commit, maxTokens: String(c.maxTokens), temp: String(c.temperature),
    modelId: c.modelId, modelUrl: c.modelUrl,
    contextSize: String(c.contextSize), seed: String(c.seed),
    prompt: c.prompt,
  });
  history.replaceState(null, '', `${window.location.pathname}?${p}`);
}

function defaultBackend() { return navigator.gpu ? 'webgpu' : 'cpu'; }
function defaultVersion(b) { return b === 'webgpu' ? DEFAULT_WEBGPU_VERSION : DEFAULT_CPU_VERSION; }
function isDefaultVersion(v) {
  return !v || v === 'dev' || v === DEFAULT_CPU_VERSION || v === DEFAULT_WEBGPU_VERSION || v === 'local-webgpu-browser';
}
function normalizeVersion(v) {
  if (!v || v === 'dev') return v ?? '';
  return v === 'local-webgpu-browser' ? DEFAULT_WEBGPU_VERSION : v;
}

// ─── Artifact resolution ──────────────────────────────────────────────────────

function resolveTarget(cfg, manifest, target) {
  const base    = `/wasm-build/dist/${cfg.version}/`;
  const backend = target.backend ?? 'cpu';
  const modFile = stripDotSlash(target.modulePath ?? `${cfg.target}.js`);
  const wasmFile = stripDotSlash(target.wasmPath);
  return { backend, modulePath: base + modFile, wasmPath: wasmFile ? base + wasmFile : undefined };
}

function stripDotSlash(v) { return v ? v.replace(/^\.\//, '') : ''; }

// ─── Result builder ───────────────────────────────────────────────────────────

function buildSample(cfg, manifest, tgt, m) {
  return {
    commit: cfg.commit, version: cfg.version, modelId: cfg.modelId,
    backend: cfg.backend, environment: 'chrome',
    environmentDetails: {
      compatibilityKey: chromeCompatKey(),
      browserVersion: chromeVersion(),
      headless: /HeadlessChrome/i.test(navigator.userAgent),
      platform: navigator.platform,
    },
    metrics: {
      startupLatencyMs: m.startupMs, downloadLatencyMs: m.dlMs,
      modelLoadLatencyMs: m.loadMs, promptLatencyMs: 0,
      decodeLatencyMs: m.decMs, tokensPerSecond: m.tps,
      peakMemoryBytes: m.memoryBytes,
    },
    outputText: m.outputText, outputTokens: m.totalTokens,
    artifactSha256: tgt.sha256 ?? '', upstreamCommit: manifest.upstreamCommit ?? '',
    recordedAt: new Date().toISOString(),
  };
}

// ─── Error helpers ────────────────────────────────────────────────────────────

function buildStructuredError(msg) {
  const fault = msg?.payload?.fault ?? msg?.fault;
  if (!fault) return new Error(msg?.message ?? 'worker error');
  const err = new Error(fault.message);
  err.name = fault.name ?? 'WasmlLlamaError';
  Object.assign(err, fault, { fault });
  return err;
}

function fmtErrDiag(err) {
  const f = err?.fault ?? err;
  if (f?.code && f?.origin) return `[${f.origin}/${f.code}] recoverable=${f.recoverable} ${f.message}`;
  return err?.message ?? String(err);
}
function fmtErrOutput(err) {
  const f = err?.fault ?? err;
  if (f?.code && f?.category) return `${f.code}: ${f.message} (${f.category}, recoverable=${f.recoverable})`;
  return err?.message ?? String(err);
}

// ─── State management ────────────────────────────────────────────────────────

function setRunState(state) {
  statusDot.className = `status-dot ${state}`;
  statusText.textContent = state;
  runBtn.disabled  = state === 'running';
  stopBtn.disabled = state !== 'running';
  Object.values(fields).forEach((el) => { el.disabled = state === 'running'; });
  copyUrlBtn.disabled = state === 'running';
  clearBtn.disabled = state === 'running';
  if (clearModelCacheBtn) {
    clearModelCacheBtn.disabled = state === 'running';
  }
}

function resetStages() { STAGES.forEach((s) => setStage(s, 'idle')); }

function setStage(name, state) {
  const n = stageNodes.get(name);
  if (n) n.dataset.state = state;
}

function setActiveStageError() {
  for (const n of stageNodes.values()) {
    if (n.dataset.state === 'active') { n.dataset.state = 'error'; break; }
  }
}

function resetMetrics() {
  Object.values(metricEls).forEach((n) => { n.textContent = '--'; n.classList.remove('live'); });
}

function setMetric(key, val) {
  const el = metricEls[key];
  if (el) { el.textContent = val; el.classList.remove('live'); }
}

function setMetricLive(key, val) {
  const el = metricEls[key];
  if (el) { el.textContent = val; el.classList.add('live'); }
}

function setMetricNormal(key) {
  metricEls[key]?.classList.remove('live');
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

function resetDiag() {
  diagLines.length = 0;
  if (diagEl) diagEl.textContent = 'No diagnostics yet.';
}

function appendDiag(line) {
  diagLines.unshift(`${new Date().toLocaleTimeString()} ${line}`);
  if (diagLines.length > 60) diagLines.length = 60;
  if (diagEl) { diagEl.textContent = diagLines.join('\n'); diagEl.scrollTop = 0; }
}

function fmtDiagMsg(msg) {
  if (msg?.extra?.code && msg?.extra?.origin) {
    const rec = msg.extra.recoverable !== undefined ? ` rec=${msg.extra.recoverable}` : '';
    return `[${msg.extra.origin}/${msg.extra.code}${rec}] ${msg.message}`;
  }
  if (msg?.extra) return `${msg.message} ${JSON.stringify(msg.extra)}`;
  return msg?.message ?? String(msg);
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function fmtMs(v) { return v < 1000 ? `${v.toFixed(0)}ms` : `${(v / 1000).toFixed(2)}s`; }

function fmtBytes(v) {
  if (!v) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, c = v;
  while (c >= 1024 && i < units.length - 1) { c /= 1024; i++; }
  return `${c.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function chromeVersion() {
  const m = navigator.userAgent.match(/Chrome\/([0-9.]+)/);
  return m ? m[1] : 'unknown';
}

function chromeCompatKey() {
  const hl = /HeadlessChrome/i.test(navigator.userAgent) ? 'headless' : 'headed';
  return `chrome:${chromeVersion()}:manual:${hl}`;
}
