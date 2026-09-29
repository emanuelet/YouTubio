const { createClient } = require("redis");

const REDIS_URL = process.env.REDIS_URL;
const CACHE_TTL = Math.max(
	1,
	Number.parseInt(process.env.CACHE_TTL ?? process.env.TTL ?? "3600", 10) ||
		3600,
);
const RETRY_DELAY = 30_000;
const MAX_LOCAL_ENTRIES = 100;
const MAX_LOCAL_BYTES = 32 * 1024 * 1024;

let client;
let connecting;
let unavailableUntil = 0;
const local = new Map();
let localBytes = 0;

function deleteLocal(key) {
	const entry = local.get(key);
	if (!entry) return;
	localBytes -= entry.bytes;
	local.delete(key);
}

function setLocal(key, serialized, ttl) {
	deleteLocal(key);
	const bytes = Buffer.byteLength(serialized);
	if (bytes > MAX_LOCAL_BYTES) return;
	const now = Date.now();
	for (const [oldKey, entry] of local) {
		if (entry.expiresAt <= now) deleteLocal(oldKey);
	}
	local.set(key, { serialized, bytes, expiresAt: now + ttl * 1000 });
	localBytes += bytes;
	while (local.size > MAX_LOCAL_ENTRIES || localBytes > MAX_LOCAL_BYTES)
		deleteLocal(local.keys().next().value);
}

function logCacheError(log, error) {
	log?.warn(
		{ errorType: error.constructor.name, integration: "redis" },
		"Redis unavailable; using in-process cache",
	);
}

async function getClient(log) {
	if (!REDIS_URL || Date.now() < unavailableUntil) return null;
	if (!client) {
		client = createClient({
			url: REDIS_URL,
			socket: { reconnectStrategy: false },
		});
		const redis = client;
		redis.on("error", (error) => logCacheError(log, error));
		connecting = redis.connect().catch(async (error) => {
			unavailableUntil = Date.now() + RETRY_DELAY;
			client = undefined;
			connecting = undefined;
			try {
				redis.destroy();
			} catch (_error) {}
			throw error;
		});
	}
	try {
		await connecting;
		return client;
	} catch (error) {
		logCacheError(log, error);
		return null;
	}
}

async function get(key, log) {
	const entry = local.get(key);
	if (entry) {
		if (entry.expiresAt <= Date.now()) deleteLocal(key);
		else {
			local.delete(key);
			local.set(key, entry);
			return JSON.parse(entry.serialized);
		}
	}
	const redis = await getClient(log);
	if (!redis) return undefined;
	try {
		const value = await redis.get(key);
		return value === null ? undefined : JSON.parse(value);
	} catch (error) {
		logCacheError(log, error);
		return undefined;
	}
}

async function set(key, value, ttl = CACHE_TTL, log) {
	const serialized = JSON.stringify(value);
	setLocal(key, serialized, ttl);
	const redis = await getClient(log);
	if (!redis) return;
	try {
		await redis.set(key, serialized, { EX: ttl });
	} catch (error) {
		logCacheError(log, error);
	}
}

module.exports = { get, set };
