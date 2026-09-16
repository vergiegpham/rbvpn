import soap from 'soap';
import { env } from '../utils/env.js';

const WSDL = 'https://my.interserver.net/api.php?wsdl';

let clientPromise = null;
let sessionCache = { sid: '', expiresAt: 0 };

function requireCreds() {
  const username = env.interserverUsername;
  const password = env.interserverPassword;
  if (!username || !password) {
    const err = new Error(
      'InterServer credentials missing. Set INTERSERVER_USERNAME and INTERSERVER_PASSWORD (or API key) in api/.env'
    );
    err.status = 503;
    throw err;
  }
  return { username, password };
}

async function getClient() {
  if (!clientPromise) {
    clientPromise = soap.createClientAsync(WSDL, {
      wsdl_options: { timeout: 60000 },
      escapeXML: true,
    }).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

function asArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object' && Array.isArray(value.item)) return value.item;
  if (typeof value === 'object') return [value];
  return [];
}

function callAsync(client, method, args = {}) {
  const fn = client[`${method}Async`];
  if (typeof fn !== 'function') {
    const err = new Error(`InterServer SOAP method missing: ${method}`);
    err.status = 502;
    throw err;
  }
  return fn.call(client, args).then((result) => {
    // soap returns [returnValue, rawResponse, soapHeader, rawRequest]
    return Array.isArray(result) ? result[0] : result;
  });
}

export function interserverConfigured() {
  return Boolean(env.interserverUsername && env.interserverPassword);
}

export async function getSession() {
  const now = Date.now();
  if (sessionCache.sid && sessionCache.expiresAt > now) {
    return sessionCache.sid;
  }
  const { username, password } = requireCreds();
  const client = await getClient();
  const sid = await callAsync(client, 'api_login', { username, password });
  if (!sid || typeof sid !== 'string') {
    const err = new Error('InterServer login failed (blank session). Check username/API key.');
    err.status = 401;
    throw err;
  }
  sessionCache = { sid, expiresAt: now + 2 * 60 * 60 * 1000 };
  return sid;
}

export async function getCatalog() {
  const client = await getClient();
  const [locations, platforms, templates, sliceTypes] = await Promise.all([
    callAsync(client, 'get_vps_locations_array'),
    callAsync(client, 'get_vps_platforms_array'),
    callAsync(client, 'get_vps_templates'),
    callAsync(client, 'get_vps_slice_types').catch(() => []),
  ]);

  const locs = asArray(locations).map((l) => ({
    id: Number(l.id ?? l.Id ?? l.ID),
    name: String(l.name ?? l.Name ?? ''),
  })).filter((l) => l.id && l.name);

  const plats = asArray(platforms).map((p) => ({
    platform: String(p.platform ?? p.Platform ?? ''),
    name: String(p.name ?? p.Name ?? ''),
  })).filter((p) => p.platform);

  const tpls = asArray(templates).map((t) => ({
    type: Number(t.type ?? t.Type ?? 0),
    virtualization: String(t.virtulization ?? t.virtualization ?? t.Virtulization ?? ''),
    bits: Number(t.bits ?? t.Bits ?? 0),
    os: String(t.os ?? t.Os ?? ''),
    version: String(t.version ?? t.Version ?? ''),
    file: String(t.file ?? t.File ?? ''),
    title: String(t.title ?? t.Title ?? ''),
  })).filter((t) => t.file && t.os);

  // Prefer Linux KVM/cloud templates for VPN nodes
  const linuxTemplates = tpls.filter(
    (t) =>
      /linux|ubuntu|debian|centos|almalinux|rocky/i.test(`${t.os} ${t.title} ${t.file}`) &&
      !/windows/i.test(`${t.os} ${t.title}`)
  );

  return {
    configured: interserverConfigured(),
    locations: locs,
    platforms: plats,
    templates: linuxTemplates.length ? linuxTemplates : tpls,
    sliceTypes: asArray(sliceTypes),
  };
}

export async function validateBuyVps(order) {
  const sid = await getSession();
  const client = await getClient();
  const result = await callAsync(client, 'api_api_validate_buy_vps', {
    sid,
    os: order.os,
    slices: Number(order.slices),
    platform: order.platform,
    controlpanel: order.controlpanel || 'none',
    period: Number(order.period || 1),
    location: Number(order.location),
    version: order.version,
    hostname: order.hostname,
    coupon: order.coupon || '',
    rootpass: order.rootpass,
  });
  return result;
}

export async function buyVps(order) {
  const sid = await getSession();
  const client = await getClient();
  const result = await callAsync(client, 'api_api_buy_vps', {
    sid,
    os: order.os,
    slices: Number(order.slices),
    platform: order.platform,
    controlpanel: order.controlpanel || 'none',
    period: Number(order.period || 1),
    location: Number(order.location),
    version: order.version,
    hostname: order.hostname,
    coupon: order.coupon || '',
    rootpass: order.rootpass,
  });
  return result;
}

export async function listVpsServices() {
  const sid = await getSession();
  const client = await getClient();
  const result = await callAsync(client, 'api_vps_get_services', { sid });
  return asArray(result).map((s) => ({
    vpsId: Number(s.vps_id ?? s.vpsId ?? 0),
    ip: String(s.vps_ip ?? s.ip ?? ''),
    hostname: String(s.vps_hostname ?? s.hostname ?? ''),
    status: String(s.vps_status ?? s.status ?? ''),
    serverStatus: String(s.vps_server_status ?? ''),
    cost: Number(s.vps_cost ?? 0),
    comment: String(s.vps_comment ?? ''),
  })).filter((s) => s.vpsId);
}

export function generateRootPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%&*';
  const all = upper + lower + digits + special;
  const pick = (set) => set[Math.floor(Math.random() * set.length)];
  let pass = pick(upper) + pick(lower) + pick(digits) + pick(special);
  for (let i = 0; i < 12; i++) pass += pick(all);
  return pass
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
}

export async function findServiceByHostname(hostname, { attempts = 12, delayMs = 5000 } = {}) {
  const target = String(hostname).toLowerCase();
  for (let i = 0; i < attempts; i++) {
    const services = await listVpsServices();
    const hit = services.find((s) => s.hostname.toLowerCase() === target && s.ip);
    if (hit) return hit;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}
