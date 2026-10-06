import { describe, expect, it } from 'vitest';
import {
  CONNECTION_TEST_PROTOCOLS,
  isAllowlistedInternalHost,
  isLoopbackApiHost,
  isRfc1918Host,
  validateBaseUrl,
} from '../src/api/connectionTest';

describe('ConnectionTestProtocol scope (Local-First fork)', () => {
  // The Local-First fork only supports the three Local-First-relevant
  // HTTP provider protocols: openai (covers OpenAI API + any
  // OpenAI-compatible gateway such as LM Studio, vLLM, OpenRouter,
  // NVIDIA, DeepInfra), anthropic (Anthropic API + Anthropic-compatible
  // endpoints), and ollama (self-hosted LLM server). The five cloud-only
  // upstream protocols (azure, google, bedrock, senseaudio, aihubmix)
  // were dropped in v0.2 because they have no Local-First use case.
  // This test asserts the runtime constant mirrors the intended set;
  // adding a new protocol to the union without updating this test is a
  // visible contract change.
  it('exposes only openai, anthropic, ollama', () => {
    expect([...CONNECTION_TEST_PROTOCOLS].sort()).toEqual([
      'anthropic',
      'ollama',
      'openai',
    ]);
  });
});

describe('provider base URL validation', () => {
  it('allows public endpoints and loopback local providers', () => {
    for (const baseUrl of [
      'https://api.openai.com/v1',
      'http://localhost:11434/v1',
      'http://127.0.0.1:11434/v1',
      'http://[::1]:11434/v1',
      'http://[::ffff:127.0.0.1]:11434/v1',
    ]) {
      expect(validateBaseUrl(baseUrl).error).toBeUndefined();
    }
  });

  it('identifies trailing-dot FQDN forms of loopback hosts as loopback', () => {
    // Direct assertion against isLoopbackApiHost — validateBaseUrl alone
    // can't distinguish "passed because loopback" from "passed because
    // not blocked", which the previous test revision conflated.
    for (const host of ['localhost.', '127.0.0.1.', '127.0.0.5.']) {
      expect(isLoopbackApiHost(host)).toBe(true);
    }
  });

  it('blocks private, link-local, CGNAT, multicast, and mapped forms', () => {
    for (const baseUrl of [
      'http://0.0.0.0:11434/v1',
      'http://10.0.0.5:11434/v1',
      'http://100.64.0.1:11434/v1',
      'http://169.254.169.254/latest/meta-data',
      'http://172.16.0.5:11434/v1',
      'http://192.168.1.5:11434/v1',
      'http://224.0.0.1:11434/v1',
      'http://[::]/v1',
      'http://[fd00::1]:11434/v1',
      'http://[fe80::1]:11434/v1',
      'http://[::ffff:192.168.1.5]:11434/v1',
    ]) {
      expect(validateBaseUrl(baseUrl)).toMatchObject({
        error: 'Internal IPs blocked',
        forbidden: true,
      });
    }
  });

  it('blocks trailing-dot FQDN bypass across every blocked IPv4 range', () => {
    // The trailing-dot strip in normalizeBracketedIpv6 must apply to
    // every range isBlockedIpv4 covers — not just the three originally
    // demonstrated. One representative case per range:
    for (const baseUrl of [
      'http://0.0.0.0.:11434/v1',              // 0.0.0.0/8
      'http://10.0.0.5.:11434/v1',             // 10/8
      'http://100.64.0.1.:11434/v1',           // 100.64/10 CGNAT
      'http://169.254.169.254./latest/meta-data', // 169.254/16 metadata
      'http://172.16.0.5.:11434/v1',           // 172.16/12
      'http://192.168.1.5.:11434/v1',          // 192.168/16
      'http://224.0.0.1.:11434/v1',            // multicast >=224
    ]) {
      expect(validateBaseUrl(baseUrl)).toMatchObject({
        error: 'Internal IPs blocked',
        forbidden: true,
      });
    }
  });

  it('allows RFC1918 hosts when allowPrivateNetworks is true (Local-First LAN carve-out)', () => {
    for (const baseUrl of [
      'http://10.0.0.5:11434/v1',               // 10/8
      'http://172.16.0.5:11434/v1',             // 172.16/12
      'http://192.168.1.5:11434/v1',            // 192.168/16
      'http://10.0.0.5.:11434/v1',              // trailing-dot FQDN
      'http://[::ffff:192.168.1.5]:11434/v1',   // IPv4-mapped IPv6 literal
    ]) {
      const result = validateBaseUrl(baseUrl, { allowPrivateNetworks: true });
      expect(result.error).toBeUndefined();
      expect(result.parsed).toBeDefined();
    }
  });

  it('still blocks RFC1918 hosts when allowPrivateNetworks is false (default)', () => {
    for (const baseUrl of [
      'http://10.0.0.5:11434/v1',
      'http://172.16.0.5:11434/v1',
      'http://192.168.1.5:11434/v1',
    ]) {
      expect(validateBaseUrl(baseUrl)).toMatchObject({
        error: 'Internal IPs blocked',
        forbidden: true,
      });
      expect(validateBaseUrl(baseUrl, { allowPrivateNetworks: false })).toMatchObject({
        error: 'Internal IPs blocked',
        forbidden: true,
      });
    }
  });

  it('keeps cloud-metadata and CGNAT blocked even when allowPrivateNetworks is true', () => {
    // The toggle is the RFC1918 carve-out, not a license to reach every
    // private address. Cloud-metadata (169.254/16) and CGNAT (100.64/10)
    // stay blocked always because they are NOT in the RFC1918 set.
    for (const baseUrl of [
      'http://169.254.169.254/latest/meta-data', // cloud metadata
      'http://100.64.0.1:11434/v1',              // CGNAT
    ]) {
      expect(validateBaseUrl(baseUrl, { allowPrivateNetworks: true })).toMatchObject({
        error: 'Internal IPs blocked',
        forbidden: true,
      });
    }
  });
});

describe('isRfc1918Host (Local-First LAN carve-out predicate)', () => {
  it('matches the three RFC1918 ranges', () => {
    expect(isRfc1918Host('10.0.0.5')).toBe(true);
    expect(isRfc1918Host('10.255.255.255')).toBe(true);
    expect(isRfc1918Host('172.16.0.1')).toBe(true);
    expect(isRfc1918Host('172.31.255.255')).toBe(true);
    expect(isRfc1918Host('192.168.0.1')).toBe(true);
    expect(isRfc1918Host('192.168.255.255')).toBe(true);
  });

  it('rejects addresses outside RFC1918', () => {
    // Just-outside the lower bound
    expect(isRfc1918Host('172.15.0.1')).toBe(false);
    expect(isRfc1918Host('172.32.0.1')).toBe(false);
    // Cloud-metadata and CGNAT must NOT match
    expect(isRfc1918Host('169.254.169.254')).toBe(false);
    expect(isRfc1918Host('100.64.0.1')).toBe(false);
    // Public addresses
    expect(isRfc1918Host('8.8.8.8')).toBe(false);
    expect(isRfc1918Host('1.1.1.1')).toBe(false);
  });

  it('rejects non-IPv4 input', () => {
    expect(isRfc1918Host('example.com')).toBe(false);
    expect(isRfc1918Host('localhost')).toBe(false);
    expect(isRfc1918Host('')).toBe(false);
    expect(isRfc1918Host('::1')).toBe(false);
    expect(isRfc1918Host('fc00::1')).toBe(false);
  });
});

describe('operator internal-host allowlist (issue #3225)', () => {
  it('exempts a literal internal IP the operator explicitly allowlisted', () => {
    expect(
      validateBaseUrl('http://10.0.0.5:4000/v1', {
        allowedInternalHosts: ['10.0.0.5'],
      }).error,
    ).toBeUndefined();
  });

  it('keeps the strict default-deny when the allowlist is empty or absent', () => {
    expect(validateBaseUrl('http://10.0.0.5:4000/v1')).toMatchObject({
      error: 'Internal IPs blocked',
      forbidden: true,
    });
    expect(
      validateBaseUrl('http://10.0.0.5:4000/v1', { allowedInternalHosts: [] }),
    ).toMatchObject({ error: 'Internal IPs blocked', forbidden: true });
  });

  it('only exempts the allowlisted host, still blocking other internal ranges', () => {
    expect(
      validateBaseUrl('http://192.168.1.5:4000/v1', {
        allowedInternalHosts: ['10.0.0.5'],
      }),
    ).toMatchObject({ error: 'Internal IPs blocked', forbidden: true });
  });

  it('matches across bracket, trailing-dot, and IPv4-mapped normalized forms', () => {
    // An operator who lists `10.0.0.5` should also exempt the trailing-dot
    // FQDN form and the IPv4-mapped IPv6 literal of the same address.
    expect(isAllowlistedInternalHost('10.0.0.5.', ['10.0.0.5'])).toBe(true);
    expect(isAllowlistedInternalHost('[::ffff:10.0.0.5]', ['10.0.0.5'])).toBe(true);
    expect(isAllowlistedInternalHost('10.0.0.5', ['[::ffff:10.0.0.5]'])).toBe(true);
    expect(isAllowlistedInternalHost('FD00::1', ['[fd00::1]'])).toBe(true);
  });

  it('returns false for an empty allowlist or a non-matching host', () => {
    expect(isAllowlistedInternalHost('10.0.0.5', [])).toBe(false);
    expect(isAllowlistedInternalHost('10.0.0.5', undefined)).toBe(false);
    expect(isAllowlistedInternalHost('10.0.0.5', ['192.168.1.5'])).toBe(false);
  });
});
