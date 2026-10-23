import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { Responses } from 'openai/resources/responses/responses';
import { z } from 'zod';
import { structured } from '../lib/llm';

const schema = z.object({ ok: z.boolean() });
const complete = { status: 'completed', output_parsed: { ok: true } } as never;
const read = () => structured('fact', schema, '读取证据', [{ type: 'input_text', text: '开放规则' }]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('OPENAI_API_KEY', 'test-secret-never-log');
  vi.stubEnv('OPENAI_BASE_URL', 'https://model.invalid/v1');
  vi.stubEnv('LLM_TIMEOUT_MS', '10000');
  vi.spyOn(console, 'error').mockImplementation(() => {});
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
