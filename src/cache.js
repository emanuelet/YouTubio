const { createClient } = require("redis");

const REDIS_URL = process.env.REDIS_URL;
const TTL = Math.max(1, Number.parseInt(process.env.TTL ?? "3600", 10) || 3600);
const RETRY_DELAY = 30_000;

let client;
let connecting;
let unavailableUntil = 0;

function logCacheError(log, error) {
	log?.warn(
		{ errorType: error.constructor.name, integration: "redis" },
		"cache unavailable; continuing without cache",
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

async function set(key, value, log) {
	const redis = await getClient(log);
	if (!redis) return;
	try {
		await redis.set(key, JSON.stringify(value), { EX: TTL });
	} catch (error) {
		logCacheError(log, error);
	}
}

module.exports = { get, set };
