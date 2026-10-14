import { describe, expect, it } from 'vitest';
import { edgeFunctionErrorMessage } from './edgeFunctionError';

const generic = 'Edge Function returned a non-2xx status code';

describe('edgeFunctionErrorMessage', () => {
  it("returns the function's own error text", async () => {
    const context = new Response(JSON.stringify({ error: 'Only clinic admins can invite therapists' }), { status: 403 });
    expect(await edgeFunctionErrorMessage({ message: generic, context })).toBe('Only clinic admins can invite therapists');
  });
  it('falls back to a message field, then the generic text', async () => {
    expect(await edgeFunctionErrorMessage({ message: generic, context: new Response(JSON.stringify({ message: 'Already invited' })) })).toBe('Already invited');
    expect(await edgeFunctionErrorMessage({ message: generic, context: new Response('<html>', { status: 502 }) })).toBe(generic);
    expect(await edgeFunctionErrorMessage({ message: generic })).toBe(generic);
  });
});
