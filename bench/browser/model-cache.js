const MODEL_CACHE_NAME = 'wasml-llama-models-v1';
const MODEL_CACHE_PREFIX = '/__wasml-llama-model-cache__/';

export async function loadModelBytes(url, modelId, onProgress = () => {}) {
  const normalizedUrl = normalizeModelUrl(url);
  const cacheKey = createCacheKey(normalizedUrl, modelId);
  const cache = await openModelCache();

  if (cache) {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      const arrayBuffer = await cachedResponse.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const totalBytes = Number(cachedResponse.headers.get('x-wasml-model-bytes') ?? bytes.byteLength);
      onProgress(totalBytes, totalBytes, { source: 'cache' });
      return {
        bytes,
        totalBytes,
        source: 'cache',
        cacheWrite: 'reused',
      };
    }
  }

  const response = await fetch(normalizedUrl, { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`model fetch: HTTP ${response.status}`);
  }

  const bytes = await readResponseBytes(response, onProgress);
  const result = {
    bytes,
    totalBytes: bytes.byteLength,
    source: 'network',
    cacheWrite: cache ? 'skipped' : 'unavailable',
  };

  if (!cache) {
    return result;
  }

  try {
    await cache.put(
      cacheKey,
      new globalThis.Response(bytes, {
        headers: {
          'content-type': 'application/octet-stream',
          'x-wasml-model-bytes': String(bytes.byteLength),
          'x-wasml-model-url': normalizedUrl,
        },
      }),
    );
    result.cacheWrite = 'stored';
  } catch (error) {
    result.cacheWrite = 'failed';
    result.cacheWriteError = error instanceof Error ? error.message : String(error);
  }

  return result;
}

export async function clearModelCache() {
  if (!hasModelCacheSupport()) {
    return {
      supported: false,
      deleted: false,
    };
  }

  const deleted = await globalThis.caches.delete(MODEL_CACHE_NAME);
  return {
    supported: true,
    deleted,
  };
}

function hasModelCacheSupport() {
  return typeof globalThis.caches?.open === 'function';
}

async function openModelCache() {
  if (!hasModelCacheSupport()) {
    return null;
  }
  return globalThis.caches.open(MODEL_CACHE_NAME);
}

function normalizeModelUrl(url) {
  const normalized = new URL(url, globalThis.location?.href);
  const sortedSearch = [...normalized.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right));

  normalized.hash = '';
  normalized.search = '';
  for (const [key, value] of sortedSearch) {
    normalized.searchParams.append(key, value);
  }

  return normalized.href;
}

function createCacheKey(normalizedUrl, modelId) {
  const key = new URL(`${MODEL_CACHE_PREFIX}${encodeURIComponent(modelId || 'default')}`, globalThis.location?.origin);
  key.searchParams.set('source', normalizedUrl);
  return key.toString();
}

async function readResponseBytes(response, onProgress) {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress(bytes.byteLength, bytes.byteLength, { source: 'network' });
    return bytes;
  }

  const totalBytes = Number(response.headers.get('Content-Length') || '0');
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    chunks.push(value);
    received += value.length;
    onProgress(received, totalBytes, { source: 'network' });
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
