import { MAX_PROVIDER_BYTES } from './limits.mjs';

/** Bound the entire provider envelope, including hidden reasoning and usage. */
export async function readProviderJSON(response, signal) {
  const tooLarge = () => Object.assign(new Error('模型响应超过 8 MiB，已停止接收；请缩小输入范围后重试。'), { name: 'ProviderResponseLimitError' });
  if (Number(response.headers?.get('content-length')) > MAX_PROVIDER_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!response.body) throw new SyntaxError('Empty provider response');
  const reader = response.body.getReader();
  let size = 0, complete = false, stop;
  const cancelled = new Promise((_, reject) => {
    stop = () => reject(signal.reason || new DOMException('Cancelled', 'AbortError'));
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
  });
  try {
    const chunks = [];
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), cancelled]);
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > MAX_PROVIDER_BYTES) throw tooLarge();
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } finally {
    signal?.removeEventListener('abort', stop);
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
