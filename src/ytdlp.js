const YTDlpWrap = require("yt-dlp-wrap-plus").default;
const fs = require("node:fs").promises;
const path = require("node:path");
const tmpdir = require("node:os").tmpdir();
const cache = new (require("node-cache"))({
	stdTTL: process.env.TTL ?? 3600,
	useClones: false,
}); // Cache for 1 hour

const { decryptConfig } = require("./config");
const {
	channelIDRegex,
	channelRegex,
	defaultConfig,
	playlistIDRegex,
	videoIDRegex,
} = require("./constants");

let counter = 0;
const ytDlpWrap = new YTDlpWrap();
const extractors = ytDlpWrap.getExtractors();
/** @type {Promise<string>} */
const supportedWebsites = extractors.then(
	(extractors) =>
		`<ul style="list-style-type: none;">${extractors.map((extractor) => `<li>${extractor}</li>`).join("")}</ul>`,
);

/**
 * Runs yt-dlp with authentication
 * @param {string} url
 * @param {string | Object} encryptedConfig
 * @param {string[]} argsArray
 * @returns {Promise<Object>}
 */
async function runYtDlpWithAuth(url, encryptedConfig, argsArray, log) {
	log?.debug({ integration: "yt-dlp" }, "resolving media metadata");
	const canCache = [channelRegex, channelIDRegex, playlistIDRegex, videoIDRegex]
		.map((r) => r.test(url))
		.some(Boolean);
	const cacheKey = url + JSON.stringify(argsArray);
	const userConfig = decryptConfig(encryptedConfig);
	const cached = cache.get(cacheKey);
	if (
		canCache &&
		!(userConfig.markWatchedOnLoad ?? defaultConfig.markWatchedOnLoad) &&
		cached
	) {
		log?.debug({ integration: "yt-dlp", cacheHit: true }, "metadata cache hit");
		return cached;
	}
	/** @type {string?} */
	const cookies = userConfig.encrypted?.auth;
	/** @type {string?} */
	const filename = cookies
		? path.join(tmpdir, `cookies-${Date.now()}-${counter++}.txt`)
		: null;
	counter %= Number.MAX_SAFE_INTEGER;
	try {
		if (filename) await fs.writeFile(filename, cookies);
		const r = JSON.parse(
			await ytDlpWrap.execPromise([
				...argsArray,
				(userConfig.markWatchedOnLoad ?? defaultConfig.markWatchedOnLoad)
					? "--mark-watched"
					: "--no-mark-watched",
				url,
				"--js-runtimes",
				"node",
				"-i",
				"--no-plugin-dirs",
				"--flat-playlist",
				"--no-cache-dir",
				"--no-warnings",
				"--ignore-no-formats-error",
				"-J",
				"--ies",
				process.env.YTDLP_EXTRACTORS ?? "all",
				"--extractor-args",
				"generic:impersonate",
				"--compat-options",
				"no-youtube-channel-redirect",
				...(cookies ? ["--cookies", filename] : []),
			]),
		);
		if (canCache) cache.set(cacheKey, r);
		log?.debug({ integration: "yt-dlp", cacheHit: false }, "metadata resolved");
		return r;
	} catch (error) {
		log?.error(
			{ errorType: error.constructor.name, integration: "yt-dlp" },
			"metadata resolution failed",
		);
		throw error;
	} finally {
		try {
			if (filename) await fs.unlink(filename);
		} catch (_error) {}
	}
}

module.exports = { runYtDlpWithAuth, supportedWebsites };
