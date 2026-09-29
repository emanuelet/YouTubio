const crypto = require("node:crypto");

const enabled = process.env.PRIVATE_MODE === "1";
const password = process.env.PRIVATE_MODE_PASSWORD;

function validateSetup() {
	if (enabled && (!password || password.length < 16))
		throw new Error("PRIVATE_MODE_PASSWORD must be at least 16 characters");
}

function correctPassword(input) {
	if (typeof input !== "string" || !password) return false;
	const expected = crypto.createHash("sha256").update(password).digest();
	const supplied = crypto.createHash("sha256").update(input).digest();
	return crypto.timingSafeEqual(expected, supplied);
}

function tokenFromConfig(config) {
	if (typeof config !== "string") return null;
	return /^p1\.([A-Za-z0-9_-]{43})\.(.+)$/.exec(config)?.[1] ?? null;
}

function unwrapConfig(config) {
	return tokenFromConfig(config) ? config.slice(47) : config;
}

module.exports = {
	correctPassword,
	enabled,
	tokenFromConfig,
	unwrapConfig,
	validateSetup,
};
