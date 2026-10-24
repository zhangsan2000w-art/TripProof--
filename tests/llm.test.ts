import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { Responses } from 'openai/resources/responses/responses';
import { Completions } from 'openai/resources/chat/completions/completions';
import { z } from 'zod';
import { structured } from '../lib/llm';
import { modelCacheIdentity, modelConfiguration } from '../lib/model-config';
import { withRunControl } from '../lib/run-control';
import { draftSchema, factOutputSchema } from '../lib/domain';
import { decisionSchema } from '../lib/agent-types';

const schema = z.object({ ok: z.boolean() });
const complete = { status: 'completed', output_parsed: { ok: true } } as never;
const read = () => structured('fact', schema, '读取证据', [{ type: 'input_text', text: '开放规则' }]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('OPENAI_API_KEY', 'test-secret-never-log');
  vi.stubEnv('OPENAI_BASE_URL', 'https://model.invalid/v1');
  vi.stubEnv('LLM_TIMEOUT_MS', '10000');
  vi.stubEnv('LLM_API_MODE', 'responses');
  vi.stubEnv('LLM_CHAT_FORMAT', 'json_object');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('DeepSeek-compatible Chat Completions', () => {
  const chatComplete = (content = '{"ok":true}', finish = 'stop') => ({ choices: [{ finish_reason: finish, message: { content } }] }) as never;
  beforeEach(() => {
    vi.stubEnv('LLM_API_MODE', 'chat_completions');
    vi.stubEnv('LLM_FACT_MODEL', 'deepseek-v4.1-flash');
  });

  it('sends JSON schema instructions and validates JSON output on the server', async () => {
    const parse = vi.spyOn(Responses.prototype, 'parse');
    const create = vi.spyOn(Completions.prototype, 'create').mockResolvedValue(chatComplete());
    expect(await read()).toEqual({ ok: true });
    const request = create.mock.calls[0][0]!;
    expect(request.model).toBe('deepseek-v4.1-flash');
    expect(request.response_format).toEqual({ type: 'json_object' });
    expect(request.messages[0].content).toContain('"type":"boolean"');
    expect(request).not.toHaveProperty('reasoning'); expect(parse).not.toHaveBeenCalled();
  });

  it('preserves image data and its source order rather than silently dropping it', async () => {
    const create = vi.spyOn(Completions.prototype, 'create').mockResolvedValue(chatComplete());
    await structured('extract', schema, '读取图片', [
      { type: 'input_text', text: '原图序号 2' },
      { type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=', detail: 'high' },
    ]);
    expect(create.mock.calls[0][0]!.messages[1].content).toEqual([
      { type: 'text', text: '原图序号 2' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=', detail: 'high' } },
    ]);
  });

  it.each([draftSchema, factOutputSchema, decisionSchema])('can serialize the real extraction, fact and agent schemas', async realSchema => {
    const create = vi.spyOn(Completions.prototype, 'create').mockRejectedValue(new OpenAI.AuthenticationError(401, {}, '', new Headers()));
    await expect(structured('fact', realSchema, '读取资料', [{ type: 'input_text', text: '测试' }])).rejects.toMatchObject({ code: 'MODEL_AUTH' });
    expect(JSON.parse(String(create.mock.calls[0][0]!.messages[0].content).split('：\n').at(-1)!)).toHaveProperty('properties');
  });

  it('supports strict JSON schema when explicitly configured', async () => {
    vi.stubEnv('LLM_CHAT_FORMAT', 'json_schema');
    const create = vi.spyOn(Completions.prototype, 'create').mockResolvedValue(chatComplete());
    await read(); expect(create.mock.calls[0][0]!.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
  });

  it.each(['not JSON', '{"ok":"yes"}'])('rejects invalid JSON or schema output before recovering: %s', async content => {
    const create = vi.spyOn(Completions.prototype, 'create').mockResolvedValueOnce(chatComplete(content)).mockResolvedValueOnce(chatComplete());
    const promise = read(); await vi.runAllTimersAsync(); expect(await promise).toEqual({ ok: true }); expect(create).toHaveBeenCalledTimes(2);
  });

  it('rejects a truncated response even when its JSON looks complete', async () => {
    const create = vi.spyOn(Completions.prototype, 'create').mockResolvedValue(chatComplete('{"ok":true}', 'length'));
    const promise = expect(read()).rejects.toMatchObject({ code: 'MODEL_INCOMPLETE' });
    await vi.runAllTimersAsync(); await promise; expect(create).toHaveBeenCalledTimes(3);
  });

  it('does not retry exhausted quota or leak the upstream credential', async () => {
    const create = vi.spyOn(Completions.prototype, 'create').mockRejectedValue(new OpenAI.RateLimitError(429, { code: 'API_KEY_QUOTA_EXHAUSTED', message: 'test-secret-never-log' }, '', new Headers()));
    await expect(read()).rejects.toMatchObject({ code: 'MODEL_QUOTA' }); expect(create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('test-secret');
  });

  it('does not retry a refusal', async () => {
    const create = vi.spyOn(Completions.prototype, 'create').mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { refusal: 'cannot process', content: null } }] } as never);
    await expect(read()).rejects.toMatchObject({ code: 'MODEL_REFUSAL' }); expect(create).toHaveBeenCalledTimes(1);
  });

  it('explains a model and endpoint mismatch without retrying', async () => {
    const create = vi.spyOn(Completions.prototype, 'create').mockRejectedValue(new OpenAI.NotFoundError(404, { type: 'model_not_found' }, '', new Headers()));
    await expect(read()).rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' }); expect(create).toHaveBeenCalledTimes(1);
  });

  it('cancellation interrupts retry backoff without another model call', async () => {
    const create = vi.spyOn(Completions.prototype, 'create').mockRejectedValue(new OpenAI.APIConnectionError({}));
    const controller = new AbortController();
    const promise = expect(withRunControl({ signal: controller.signal }, read)).rejects.toThrow('stop');
    await vi.advanceTimersByTimeAsync(0); controller.abort(new Error('stop')); await promise;
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('keeps LLM credentials separate from optional search credentials and caches', () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'search-only-secret');
    const config = modelConfiguration('agent'); expect(config.model).toBe('deepseek-v4.1-flash'); expect(config.apiKey).toBe('test-secret-never-log');
    const before = modelCacheIdentity('fact'); vi.stubEnv('OPENAI_BASE_URL', 'https://other.invalid/v1');
    expect(modelCacheIdentity('fact')).not.toEqual(before); expect(JSON.stringify(before)).not.toContain('secret');
    vi.stubEnv('LLM_API_MODE', 'typo'); expect(() => modelConfiguration()).toThrow('模型接口配置无效');
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('model failure recovery', () => {
  it('backs off between transient connection failures without logging upstream content', async () => {
    const error = new OpenAI.APIConnectionError({ message: 'test-secret-never-log private input' });
    const parse = vi.spyOn(Responses.prototype, 'parse').mockRejectedValueOnce(error).mockRejectedValueOnce(error).mockResolvedValueOnce(complete);
    const result = read();
    await vi.advanceTimersByTimeAsync(0); expect(parse).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999); expect(parse).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(parse).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000); expect(await result).toEqual({ ok: true });
    expect(parse).toHaveBeenCalledTimes(3);
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logs).toContain('connection'); expect(logs).not.toContain('test-secret'); expect(logs).not.toContain('private input');
  });

  it('recovers from a temporary HTTP rate limit', async () => {
    const parse = vi.spyOn(Responses.prototype, 'parse')
      .mockRejectedValueOnce(new OpenAI.RateLimitError(429, { message: 'busy' }, '', new Headers()))
      .mockResolvedValueOnce(complete);
    const result = read(); await vi.runAllTimersAsync();
    expect(await result).toEqual({ ok: true }); expect(parse).toHaveBeenCalledTimes(2);
  });

  it('does not retry invalid authentication', async () => {
    const parse = vi.spyOn(Responses.prototype, 'parse').mockRejectedValue(new OpenAI.AuthenticationError(401, {}, '', new Headers()));
    await expect(read()).rejects.toMatchObject({ code: 'MODEL_AUTH' }); expect(parse).toHaveBeenCalledTimes(1);
  });

  it('never accepts a truncated response even if it contains a parsed-looking value', async () => {
    const parse = vi.spyOn(Responses.prototype, 'parse').mockResolvedValue({ status: 'incomplete', output_parsed: { ok: true } } as never);
    const result = expect(read()).rejects.toMatchObject({ code: 'MODEL_INCOMPLETE' });
    await vi.runAllTimersAsync(); await result; expect(parse).toHaveBeenCalledTimes(3);
  });

  it('validates structured output again before accepting it', async () => {
    const parse = vi.spyOn(Responses.prototype, 'parse').mockResolvedValueOnce({ status: 'completed', output_parsed: { ok: 'yes' } } as never).mockResolvedValueOnce(complete);
    const result = read(); await vi.runAllTimersAsync(); expect(await result).toEqual({ ok: true }); expect(parse).toHaveBeenCalledTimes(2);
  });

  it('bounds all retries by the previous two-request time budget', async () => {
    const started = Date.now();
    const parse = vi.spyOn(Responses.prototype, 'parse');
    parse.mockRejectedValueOnce(new OpenAI.APIConnectionError({}));
    parse.mockImplementation((_body, options) => new Promise((_resolve, reject) => setTimeout(() => reject(new OpenAI.APIConnectionTimeoutError()), options!.timeout!)) as never);
    const result = expect(read()).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    await vi.runAllTimersAsync(); await result;
    expect(Date.now() - started).toBe(20000);
    expect(parse).toHaveBeenCalledTimes(3);
    expect(parse.mock.calls.map(c => c[1]!.timeout)).toEqual([10000, 10000, 7000]);
  });
});
