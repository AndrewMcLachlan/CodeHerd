import { describe, expect, it } from 'vitest';
import { isSafeExternalUrl } from './external-links';

describe('isSafeExternalUrl', () => {
  it('allows http and https', () => {
    expect(isSafeExternalUrl('http://example.com')).toBe(true);
    expect(isSafeExternalUrl('https://example.com/a/b?c=d#e')).toBe(true);
  });

  it('allows uppercase and surrounding whitespace', () => {
    // Terminal output is not tidy; a prefix match would reject both of these.
    expect(isSafeExternalUrl('HTTPS://example.com')).toBe(true);
    expect(isSafeExternalUrl('  https://example.com  ')).toBe(true);
  });

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'smb://server/share',
    'mailto:someone@example.com',
    'ms-msdt:/id',
  ])('refuses %s', (url) => {
    // openExternal hands the URL to the OS, which runs whatever is registered
    // for the scheme — so anything beyond http/https can launch real software
    // from text an agent merely printed.
    expect(isSafeExternalUrl(url)).toBe(false);
  });

  it('refuses text that is not a URL', () => {
    expect(isSafeExternalUrl('')).toBe(false);
    expect(isSafeExternalUrl('   ')).toBe(false);
    expect(isSafeExternalUrl('example.com')).toBe(false);
    expect(isSafeExternalUrl('not a url at all')).toBe(false);
  });

  it('refuses a scheme that merely starts with http', () => {
    // A prefix check for 'http' would wave this through.
    expect(isSafeExternalUrl('httpx://example.com')).toBe(false);
  });
});
