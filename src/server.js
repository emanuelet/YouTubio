#!/usr/bin/env node

const VERSION = require("../package.json").version;
const app = require("fastify")({
	trustProxy: true,
	logger: process.env.DEV_LOGGING ? { level: "debug" } : false,
	// Encrypted configuration is encoded in the Stremio URL path.
	routerOptions: { maxParamLength: 65_536 },
});
const closeWithGrace = require("close-with-grace");
const YTDlpWrap = require("yt-dlp-wrap-plus").default;
const fs = require("node:fs").promises;
const path = require("node:path");
const {
	decryptConfig,
	encrypt,
	encryptionKey,
	hasEncryptionKey,
} = require("./config");

const {
	channelIDRegex,
	channelRegex,
	channelTypeArray,
	defaultConfig,
	playlistIDRegex,
	prefix,
	reversedPrefix,
	sortKeyword,
	termKeyword,
	videoIDRegex,
} = require("./constants");
const { cutM3U8 } = require("./m3u8");
const cache = new (require("node-cache"))({
	stdTTL: process.env.TTL ?? 3600,
	useClones: false,
}); // Cache for 1 hour

const tmpdir = require("node:os").tmpdir();
const ytDlpWrap = new YTDlpWrap();
/** @type {number} */
const PORT = process.env.PORT ?? 7000;
const extractors = ytDlpWrap.getExtractors();
/** @type {Promise<string>} */
const supportedWebsites = new Promise(async (resolve) =>
	resolve(
		`<ul style="list-style-type: none;">${(await extractors).map((extractor) => "<li>" + extractor + "</li>").join("")}</ul>`,
	),
);

let counter = 0;
/**
 * Runs yt-dlp with authentication
 * @param {string} url
 * @param {string | Object} encryptedConfig
 * @param {string[]} argsArray
 * @returns {Promise<Object>}
 */
async function runYtDlpWithAuth(url, encryptedConfig, argsArray) {
	const canCache = [channelRegex, channelIDRegex, playlistIDRegex, videoIDRegex]
		.map((r) => r.test(url))
		.some(Boolean);
	const cacheKey = url + JSON.stringify(argsArray);
	const userConfig = decryptConfig(encryptedConfig);
	if (
		canCache &&
		!(userConfig.markWatchedOnLoad ?? defaultConfig.markWatchedOnLoad) &&
		(cached = cache.get(cacheKey))
	)
		return cached;
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
		return r;
	} finally {
		try {
			if (filename) await fs.unlink(filename);
		} catch (error) {}
	}
}

/**
 * @typedef {{
 * titles: Array<{
 * title: string,
 * original: boolean,
 * votes: number,
 * locked: boolean,
 * UUID: string,
 * userID: string
 * }>,
 * thumbnails: Array<{
 * timestamp: number,
 * original: boolean,
 * votes: number,
 * locked: boolean,
 * UUID: string,
 * userID: string
 * }>,
 * randomTime: number,
 * videoDuration: number | null
 * }} DeArrowResponse
 */

/**
 * Get DeArrow branding data
 * @param {string} videoID
 * @returns {Promise<DeArrowResponse>}
 */
async function runDeArrow(videoID) {
	if (process.env.NO_DEARROW) throw new Error("DeArrow Error: NO_DEARROW");
	const res = await fetch(
		"https://sponsor.ajay.app/api/branding?videoID=" + videoID,
	);
	if (!res.ok)
		throw new Error(`DeArrow Error: ${res.status} ${res.statusText}`);
	return res.json();
}

/**
 * Get DeArrow thumbnail URL
 * @param {string} videoID
 * @param {number} time
 * @returns {string}
 */
function getDeArrowThumbnail(videoID, time) {
	return `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoID}&time=${time}`;
}

/**
 * @typedef {{
 * segment: [number, number],
 * UUID: string,
 * category: string,
 * videoDuration: number,
 * actionType: string,
 * locked: number,
 * votes: number,
 * description: string
 * }} SponsorBlockSegment
 */

/**
 *
 * @param {string | Object} encryptedConfig
 * @param {string} URL
 * @returns {Promise<Array<SponsorBlockSegment>>}
 */
async function getGeminiSegments(encryptedConfig, URL) {
	const userConfig = decryptConfig(encryptedConfig);
	const geminiModel = userConfig.geminiModel ?? defaultConfig.geminiModel;
	const geminiKey = userConfig.encrypted?.gemini;
	if (geminiModel && geminiKey)
		return JSON.parse(
			(
				await (
					await fetch(
						`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
						{
							method: "POST",
							body: JSON.stringify({
								system_instruction: {
									parts: {
										text: "Analyze the video contents and provide SponsorBlock-like metadata for video segments a user may not want to see where segment is an (int, int) with the values respectively being start and end time in seconds and the description being additional category acting as a section subtitle. There should be an empty Array response if no such sponsor segments exist within the video",
									},
								},
								contents: [
									{
										parts: [
											{
												file_data: {
													file_uri: URL,
												},
											},
										],
									},
								],
								generationConfig: {
									response_mime_type: "application/json",
									response_schema: {
										type: "object",
										properties: {
											segments: {
												type: "array",
												items: {
													type: "object",
													properties: {
														segment: {
															type: "array",
															items: {
																type: "number",
															},
														},
														category: {
															type: "string",
															enum: [
																"sponsor",
																"selfpromo",
																"interaction",
																"intro",
																"outro",
																"preview",
																"hook",
																"filler",
															],
														},
														description: {
															type: "string",
														},
													},
													propertyOrdering: [
														"segment",
														"category",
														"description",
													],
													required: ["description"],
												},
											},
										},
										propertyOrdering: ["segments"],
									},
								},
							}),
						},
					)
				).json()
			).candidates?.[0].content?.parts[0].text ?? "[]",
		).segments;
	return [];
}

/**
 * Get SponsorBlock segments for a video
 * @param {string} videoID
 * @param {string | Object} encryptedConfig
 * @returns {Promise<Array<SponsorBlockSegment>>}
 */
async function getSponsorBlockSegments(videoID, encryptedConfig) {
	if (process.env.NO_SPONSORBLOCK)
		throw new Error("SponsorBlock Error: NO_SPONSORBLOCK");
	const res = await fetch(
		"https://sponsor.ajay.app/api/skipSegments?videoID=" + videoID,
	);
	if (!res.ok) {
		if (res.status !== 404)
			throw new Error(`SponsorBlock Error: ${res.status} ${res.statusText}`);
		return getGeminiSegments(encryptedConfig, toYouTubeURL({}, videoID, {}));
	}
	return res.json();
}

app.addHook("onSend", async (req, reply) => {
	reply.header("Access-Control-Allow-Origin", "*");
	reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
	reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
});

app.options("*", async (req, reply) => reply.code(204).send());

app.get("/stream/:url", async (req, reply) => {
	try {
		const header = (
			await fetch(req.params.url, { method: "HEAD" })
		).headers.get("content-type");
		let content;
		switch (header) {
			case "application/vnd.apple.mpegurl":
			case "application/x-mpegURL":
				content = await (await fetch(req.params.url)).text();
				try {
					content = cutM3U8(
						content,
						JSON.parse(req.query.ranges ?? "[]"),
						JSON.parse(req.query.overestimate ?? defaultConfig.overestimate),
					);
				} catch (error) {
					if (!JSON.parse(req.query.fallback ?? defaultConfig.fallback))
						throw error;
				}
				break;
			default:
				throw new Error(`Unknown header type: "${header}"`);
		}
		return reply.type(header).send(content);
	} catch (error) {
		logError(error);
		return reply.code(500).send("Cutting stream failed");
	}
});

// Config Encryption Endpoint
app.post("/encrypt", (req, reply) => {
	try {
		return reply.send(encrypt(JSON.stringify(req.body)));
	} catch (error) {
		logError(error);
		return reply.code(500).send("Encryption failed");
	}
});

// Get YouTube Playlists Endpoint
app.get("/:config/playlists", async (req, reply) => {
	try {
		return reply.send(
			(
				await runYtDlpWithAuth(
					"https://www.youtube.com/feed/playlists",
					req.params.config,
					["--yes-playlist"],
				)
			).entries.map((x) => ({
				id: x.url,
				name: x.title,
			})),
		);
	} catch (error) {
		logError(error);
		return reply.code(500).send("Fetching playlists failed");
	}
});

/**
 * Logs an error if DEV_LOGGING is enabled
 * @param {Error} error
 * @returns {void}
 */
function logError(error) {
	if (process.env.DEV_LOGGING) console.error(error);
}

/**
 * Tests whether a string is a valid URL
 * @param {string} s
 * @returns {boolean}
 */
function isURL(s) {
	try {
		return Boolean(new URL(s));
	} catch {
		return false;
	}
}

// Stremio Addon Manifest Route
app.get("/:config/manifest.json", (req, reply) => {
	try {
		const userConfig = decryptConfig(req.params.config, false);
		const canGenre = /** @param {Object} c */ (c) => {
			if (c.channelType !== "auto") return true;
			const id = c.id?.startsWith(prefix)
				? c.id.slice(prefix.length)
				: (c.id ?? "");
			if (
				[
					":ytfav",
					":ytwatchlater",
					":ytsubs",
					":ythistory",
					":ytrec",
					":ytnotif",
				].includes(id)
			)
				return false;
			if (channelRegex.test(id)) return false;
			if (channelIDRegex.test(id)) return false;
			if (playlistIDRegex.test(id)) return false;
			if (videoIDRegex.test(id)) return false;
			if ([":ytsearch", ":ytsearch:channel"].includes(id)) return true;
			if (id.startsWith("https://www.youtube.com/results?search_query="))
				return true;
			return !isURL(id);
		};
		const catalogs = [
			...(userConfig.catalogs?.map((c) => ({
				...c,
				extra: [
					...(c.extra ?? []),
					...(c.channelType === "auto" &&
					(c.id.includes(termKeyword) ||
						[":ytsearch", ":ytsearch:channel"].includes(
							c.id.startsWith(prefix) ? c.id.slice(prefix.length) : c.id,
						))
						? [{ name: "search", isRequired: true }]
						: []),
				],
				// Add defaults if cookies were provided
			})) ??
				(userConfig.encrypted
					? [
							{ id: ":ytrec", name: "Discover" },
							{ id: ":ytsubs", name: "Subscriptions" },
							{ id: ":ytwatchlater", name: "Watch Later" },
							{ id: ":ythistory", name: "History" },
							// Add search unless explicitly disabled
						]
					: [])),
			...((userConfig.search ?? defaultConfig.search)
				? [
						{ id: ":ytsearch", name: "Video" },
						{ id: ":ytsearch:channel", name: "Channel" },
					]
				: []
			).map((c) => ({
				...c,
				extra: [...(c.extra ?? []), { name: "search", isRequired: true }],
			})),
		].map((c) => ({
			...c,
			id: c.id?.startsWith(prefix) ? c.id : prefix + (c.id ?? ""),
			type: c.type ?? userConfig.catalogType ?? defaultConfig.catalogType,
			extra: [
				...(c.extra ?? []),
				{
					name: "genre",
					isRequired: false,
					options: [
						"",
						// Add YouTube sorting options if none provided
						...(c.sortOrder?.map((s) => s.name) ??
							(canGenre(c)
								? ["Relevance", "Upload Date", "View Count", "Rating"]
								: [])),
					]
						.flatMap((x) => [x, `${reversedPrefix} ${x}`.trim()]) // Create reversed of each option
						.slice(1), // Remove default sorting option
				},
				{
					name: "skip",
					isRequired: false,
				},
			],
		}));
		return reply.send({
			id: "youtubio.elfhosted.com",
			version: VERSION,
			name: "YouTubio | ElfHosted",
			description:
				"Watch YouTube videos, subscriptions, watch later, and history in Stremio.",
			resources: ["catalog", "stream", "meta", "subtitles"],
			types: [...new Set(catalogs.map((c) => c.type))],
			idPrefixes: [prefix],
			catalogs,
			logo: `https://github.com/xXCrash2BomberXx/YouTubio/blob/${process.env.DEV_LOGGING ? "main" : `v${VERSION}`}/icon.png?raw=true`,
			behaviorHints: {
				configurable: true,
			},
			stremioAddonsConfig: {
				issuer: "https://stremio-addons.net",
				signature:
					"eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..tLliZZqbqp8DSpNFCa_o7g.1Zu-sGRA8Xmc-qG9d_ctvcvrbtBFdVH8Kqmj9RL-ONB5C5iiy5qITOH3Z1nrTfQuiIhwJyQuU0npD0S8lYtv5InjpulZHYQDdBJpPnTvn1jqwM4AgDPCpm05lNLYW3Kp.IpryYoO1JqXwFBmkHrD3OA",
			},
		});
	} catch (error) {
		logError(error);
		return reply.send({});
	}
});

/**
 * Converts a YouTube video ID and query parameters into a YouTube URL.
 * @param {Object} userConfig
 * @param {string} videoId
 * @param {Object} query
 * @returns {string}
 */
function toYouTubeURL(userConfig, videoId, query) {
	/** @type {RegExpMatchArray?} */
	let temp;
	const catalogConfig =
		userConfig.catalogs?.find((cat) => videoId === cat.id) ?? {};
	if (videoId.startsWith(prefix)) videoId = videoId.slice(prefix.length);
	/** @type {string} */
	const genre =
		(query.genre?.startsWith(reversedPrefix)
			? query.genre.slice(reversedPrefix.length)
			: query.genre
		)?.trim() ?? "Relevance";
	if (catalogConfig.channelType === "video" || videoId === ":ytsearch")
		return `https://www.youtube.com/results?search_query=${encodeURIComponent(query.search ?? "")}&sp=${
			{
				Relevance: "CAASAhAB",
				"Upload Date": "CAISAhAB",
				"View Count": "CAMSAhAB",
				Rating: "CAESAhAB",
			}[genre]
		}`;
	else if (
		catalogConfig.channelType === "channel" ||
		videoId === ":ytsearch:channel"
	)
		return `https://www.youtube.com/results?search_query=${encodeURIComponent(query.search ?? "")}&sp=${
			{
				Relevance: "CAASAhAC",
				"Upload Date": "CAISAhAC",
				"View Count": "CAMSAhAC",
				Rating: "CAESAhAC",
			}[genre]
		}`;
	else if (
		[termKeyword, sortKeyword].some((keyword) =>
			catalogConfig.id?.includes(keyword),
		)
	)
		return (
			catalogConfig.id.startsWith(prefix)
				? catalogConfig.id.slice(prefix.length)
				: catalogConfig.id
		)
			.replaceAll(termKeyword, encodeURIComponent(query.search ?? ""))
			.replaceAll(
				sortKeyword,
				catalogConfig.sortOrder?.find((s) => s.name === genre)?.id ?? "",
			);
	else if (
		[
			":ytfav",
			":ytwatchlater",
			":ytsubs",
			":ythistory",
			":ytrec",
			":ytnotif",
		].includes(videoId)
	)
		return videoId;
	else if ((temp = videoId.match(channelRegex)?.groups.id))
		return `https://www.youtube.com/${temp}/videos`;
	else if ((temp = videoId.match(channelIDRegex)?.groups.id))
		return `https://www.youtube.com/channel/${temp}/videos`;
	else if ((temp = videoId.match(playlistIDRegex)?.groups.id))
		return "https://www.youtube.com/playlist?list=" + temp;
	else if ((temp = videoId.match(videoIDRegex)?.groups.id))
		return "https://www.youtube.com/watch?v=" + temp;
	else if (isURL(videoId)) return videoId;
	return `https://www.youtube.com/results?search_query=${encodeURIComponent(videoId)}&sp=${
		{
			Relevance: "CAASAhAB",
			"Upload Date": "CAISAhAB",
			"View Count": "CAMSAhAB",
			Rating: "CAESAhAB",
		}[genre]
	}`;
}

/**
 * Parse a request into a manifest URL
 * @param {import('fastify').FastifyRequest} req
 * @returns {string}
 */
function toManifestURL(req) {
	const config = req.params.config.startsWith("c2.")
		? req.params.config
		: `c2.${Buffer.from(req.params.config).toString("base64url")}`;
	return encodeURIComponent(
		`${req.protocol}://${req.headers.host}/${config}/manifest.json`,
	);
}

/**
 * Parse a YT-DLP video object into a link to a video's channel
 * @param {Object} userConfig
 * @param {Object} video
 * @param {string} manifestUrl
 * @param {string} protocol
 * @param {boolean} useID
 * @returns {string}
 */
function toChannelManifestURL(userConfig, video, manifestUrl, protocol, useID) {
	return `${protocol}/discover/${manifestUrl}/${userConfig.catalogType ?? defaultConfig.catalogType}/${encodeURIComponent(prefix + (useID ? video.channel_id : video.channel_url))}`;
}

/**
 * Parse a YT-DLP video object into Stremio meta
 * @param {Object} userConfig
 * @param {Object} video
 * @param {string} manifestUrl
 * @param {string} protocol
 * @param {boolean} useID
 * @param {string} videoID
 * @param {boolean} playlist
 * @param {string} type
 * @returns {Promise<Object>}
 */
async function parseMeta(
	userConfig,
	video,
	manifestUrl,
	protocol,
	useID,
	videoID,
	playlist,
	type,
) {
	const channel =
		useID && (channelRegex.test(video.id) || channelIDRegex.test(video.id));
	/** @type {DeArrowResponse?} */
	let deArrow = null;
	try {
		if (useID && videoIDRegex.test(video.id) && userConfig.dearrow)
			deArrow = await runDeArrow(video.id);
	} catch (error) {
		logError(error);
	}
	/** @type {string?} */
	const thumbnail =
		(deArrow?.thumbnails[0]
			? getDeArrowThumbnail(video.id, deArrow.thumbnails[0].timestamp)
			: null) ??
		video.thumbnail ??
		video.thumbnails?.at(-1)?.url;
	return {
		id: useID ? prefix + video.id : playlist ? prefix + video.url : videoID,
		type,
		name: deArrow?.titles[0]?.title ?? video.title ?? "Unknown Title",
		poster: thumbnail
			? (thumbnail.startsWith("//") ? "https:" : "") + thumbnail
			: undefined, // Handle YouTube Channel List Relative Thumbnails
		posterShape: channel ? "square" : "landscape",
		releaseInfo:
			parseInt(
				video.release_year ??
					(video.release_date ?? video.upload_date)?.substring(0, 4) ??
					new Date(
						(video.release_timestamp ?? video.timestamp) * 1000,
					).getFullYear(),
			) || undefined,
		links: [
			...(video.channel
				? [
						{
							name: video.channel,
							category: "Directors",
							url: toChannelManifestURL(
								userConfig,
								video,
								manifestUrl,
								protocol,
								useID,
							),
						},
					]
				: []),
			...[...(video.categories ?? []), ...(video.tags ?? [])].map((genre) => ({
				name: genre,
				category: "Genres",
				url: `${protocol}/search?search=${encodeURIComponent(genre)}`,
			})),
		],
		description: video.description,
	};
}

// Stremio Addon Catalog Route
async function handleCatalog(req, reply) {
	try {
		if (!req.params.id?.startsWith(prefix))
			throw new Error(`Unknown ID in Catalog handler: "${req.params.id}"`);
		const userConfig = decryptConfig(req.params.config, false);
		const query = Object.fromEntries(
			new URLSearchParams(req.params.extra ?? ""),
		);
		const skip = parseInt(query.skip ?? 0);
		const url = toYouTubeURL(userConfig, req.params.id, query);
		const videos = await runYtDlpWithAuth(url, req.params.config, [
			"-I",
			query.genre?.startsWith(reversedPrefix)
				? `${-(skip + 1)}:${-(skip + 100)}:-1`
				: `${skip + 1}:${skip + 100}:1`,
			"--yes-playlist",
		]);
		const useID = videos.webpage_url_domain === "youtube.com";
		const playlist = videos._type === "playlist";
		const ref = req.headers.referrer;
		const protocol = ref ? ref + "#" : "stremio://";
		const canCache = [
			channelRegex,
			channelIDRegex,
			playlistIDRegex,
			videoIDRegex,
		]
			.map((r) => r.test(url))
			.some(Boolean);
		return reply.send({
			metas: (
				await Promise.all(
					(playlist ? videos.entries : [videos]).map((video) =>
						parseMeta(
							userConfig,
							video,
							toManifestURL(req),
							protocol,
							useID,
							req.params.id,
							playlist,
							req.params.type,
						),
					),
				)
			).filter((meta) => meta !== null),
			behaviorHints: { cacheMaxAge: canCache ? (process.env.TTL ?? 3600) : 0 },
		});
	} catch (error) {
		logError(error);
		return reply.send({ metas: [] });
	}
}

// Fastify does not support an optional parameter before the .json suffix.
app.get("/:config/catalog/:type/:id.json", handleCatalog);
app.get("/:config/catalog/:type/:id/:extra.json", handleCatalog);

/**
 * Parse a YT-DLP video object into Stremio streams
 * @param {Object} userConfig
 * @param {Object} video
 * @param {string} manifestUrl
 * @param {string} protocol
 * @param {string} reqProtocol
 * @param {string} reqHost
 * @returns {Promise<Array<Object>>}
 */
async function parseStream(
	userConfig,
	video,
	manifestUrl,
	protocol,
	reqProtocol,
	reqHost,
) {
	let ranges = [];
	try {
		if (videoIDRegex.test(video.id))
			ranges = (await getSponsorBlockSegments(video.id, userConfig))
				.filter((s) => userConfig.sponsorblock?.includes(s.category))
				.map((s) => s.segment);
	} catch (error) {
		logError(error);
	}
	const rangesURI = ranges.length
		? encodeURIComponent(JSON.stringify(ranges))
		: null;
	const useID = video.webpage_url_domain === "youtube.com";
	return [
		...(video.formats ?? [video])
			.filter(
				(src) =>
					((userConfig.showBrokenLinks ?? defaultConfig.showBrokenLinks) ||
						(!src.format_id?.startsWith("sb") &&
							src.acodec !== "none" &&
							src.vcodec !== "none")) &&
					src.url,
			)
			.toReversed()
			.flatMap((src) => {
				const base = {
					description: src.format,
					behaviorHints: {
						videoSize: src.filesize_approx,
						filename: video.filename,
					},
				};
				return [
					...(src.protocol === "m3u8_native" && rangesURI
						? [
								{
									...base,
									name: `SB Player ${src.resolution}`,
									url: `${reqProtocol}://${reqHost}/stream/${encodeURIComponent(src.url)}?ranges=${rangesURI}${
										(userConfig.fallback ?? defaultConfig.fallback)
											? "&fallback=1"
											: ""
									}${
										(userConfig.overestimate ?? defaultConfig.overestimate)
											? "&overestimate=1"
											: ""
									}`,
									behaviorHints: {
										...base.behaviorHints,
										bingeGroup: `SB Player ${src.resolution}`,
										notWebReady: true,
									},
								},
							]
						: []),
					{
						...base,
						name: `YT-DLP Player ${src.resolution}`,
						url: src.url,
						behaviorHints: {
							...base.behaviorHints,
							bingeGroup: `YT-DLP Player ${src.resolution}`,
							...(src.protocol !== "https" || src.video_ext !== "mp4"
								? { notWebReady: true }
								: {}),
						},
					},
				];
			}),
		...(useID &&
		(((video.is_live ?? false) && channelIDRegex.test(video.id)) ||
			videoIDRegex.test(video.id))
			? [
					{
						name: "Stremio Player",
						ytId: video.id,
						description:
							"Click to watch using Stremio's built-in YouTube Player",
						behaviorHints: {
							bingeGroup: "Stremio Player",
							filename: video.filename,
						},
					},
					{
						name: "External Player",
						externalUrl: video.webpage_url,
						description: "Click to watch in the External Player",
					},
				]
			: []),
		...(video.channel_url
			? [
					{
						name: "YT-DLP Channel",
						externalUrl: `${protocol}/discover/${manifestUrl}/${userConfig.catalogType ?? defaultConfig.catalogType}/${encodeURIComponent(prefix + (useID ? video.channel_id : video.channel_url))}`,
						description: "Click to open the channel as a Catalog",
					},
					{
						name: "External Channel",
						externalUrl: video.channel_url,
						description: "Click to open the channel in the External Player",
					},
				]
			: []),
	];
}

// Stremio Addon Meta Route
app.get("/:config/meta/:type/:id.json", async (req, reply) => {
	try {
		if (!req.params.id?.startsWith(prefix))
			throw new Error(`Unknown ID in Meta handler: "${req.params.id}"`);
		const userConfig = decryptConfig(req.params.config, false);
		const video = await runYtDlpWithAuth(
			toYouTubeURL(userConfig, req.params.id, {}),
			req.params.config,
			["-I", ":100", "--no-playlist"],
		);
		const useID = video.webpage_url_domain === "youtube.com";
		const channel =
			useID && (channelRegex.test(video.id) || channelIDRegex.test(video.id));
		const playlist = video._type === "playlist";
		const parseDate = (video) => {
			let r = 0;
			if ((d = video.release_date ?? video.upload_date))
				r = `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}T00:00:00Z`;
			if ((t = video.release_timestamp ?? video.timestamp)) r = t * 1000;
			return new Date(r).toISOString();
		};
		const released = parseDate(video);
		const manifestUrl = toManifestURL(req);
		const ref = req.headers.referrer;
		const protocol = ref ? ref + "#" : "stremio://";
		const live = channel
			? await runYtDlpWithAuth(
					`https://www.youtube.com/channel/${video.id}/live`,
					req.params.config,
					["-I", ":1", "--no-playlist"],
				)
			: null;
		const meta = await parseMeta(
			userConfig,
			video,
			manifestUrl,
			protocol,
			useID,
			req.params.id,
			playlist,
			req.params.type,
		);
		const videos = [video, ...(live?.is_live ? [live] : [])];
		return reply.send({
			meta: {
				...meta,
				background: meta.poster,
				released,
				videos: [
					...(await Promise.all(
						videos.map(async (video2, episode) => ({
							id: `${req.params.id}:1:${episode + 1}`,
							title:
								playlist && episode === 0 ? "Channel Options" : video2.title,
							released,
							thumbnail: meta.poster,
							streams: await parseStream(
								userConfig,
								video2,
								manifestUrl,
								protocol,
								req.protocol,
								req.headers.host,
							),
							available: true,
							episode: episode + 1,
							season: 1,
							overview:
								playlist && episode === 0
									? "Open the channel as a catalog"
									: video2.description,
						})),
					)),
					...(await Promise.all(
						video.entries?.map(async (video2, episode) => {
							let deArrow = null;
							try {
								if (useID && videoIDRegex.test(video2.id) && userConfig.dearrow)
									deArrow = await runDeArrow(video2.id);
							} catch (error) {
								logError(error);
							}
							return {
								id: prefix + video2.id,
								title:
									deArrow?.titles[0]?.title ?? video2.title ?? "Unknown Title",
								released: parseDate(video2),
								thumbnail:
									(deArrow?.thumbnails[0]
										? getDeArrowThumbnail(
												video2.id,
												deArrow.thumbnails[0].timestamp,
											)
										: null) ??
									video2.thumbnail ??
									video2.thumbnails?.at(-1)?.url,
								available: true,
								episode: episode + videos.length + 1,
								season: 1,
								overview: video2.description,
							};
						}) ?? [],
					)),
				],
				runtime: `${Math.floor((video.duration ?? 0) / 60)} min`,
				language: video.language,
				website: video.webpage_url,
				...(video._type === "playlist"
					? {}
					: { behaviorHints: { defaultVideoId: req.params.id + ":1:1" } }),
			},
		});
	} catch (error) {
		logError(error);
		return reply.send({ meta: {} });
	}
});

// Stremio Addon Stream Route
app.get("/:config/stream/:type/:id.json", async (req, reply) => {
	try {
		if (!req.params.id?.startsWith(prefix))
			throw new Error(`Unknown ID in Stream handler: "${req.params.id}"`);
		const userConfig = decryptConfig(req.params.config, false);
		const video = await runYtDlpWithAuth(
			toYouTubeURL(userConfig, req.params.id, {}),
			req.params.config,
			["-I", ":1", "--no-playlist"],
		);
		const ref = req.headers.referrer;
		const protocol = ref ? ref + "#" : "stremio://";
		return reply.send({
			streams: await parseStream(
				userConfig,
				video,
				toManifestURL(req),
				protocol,
				req.protocol,
				req.headers.host,
			),
		});
	} catch (error) {
		logError(error);
		return reply.send({ streams: [] });
	}
});

// Stremio Addon Subtitles Route
app.get("/:config/subtitles/:type/:id.json", async (req, reply) => {
	try {
		if (!req.params.id?.startsWith(prefix))
			throw new Error(`Unknown ID in Subtitles handler: "${req.params.id}"`);
		const userConfig = decryptConfig(req.params.config, false);
		const video = await runYtDlpWithAuth(
			toYouTubeURL(userConfig, req.params.id, {}),
			req.params.config,
			["-I", ":1", "--no-playlist"],
		);
		return reply.send({
			subtitles: [
				...Object.entries(video.subtitles ?? {}).map(([k, v]) => {
					const srt = v.find((x) => x.ext == "srt") ?? v[0];
					return srt
						? {
								id: srt.name,
								url: srt.url,
								lang: k,
							}
						: null;
				}),
				...Object.entries(video.automatic_captions ?? {}).map(([k, v]) => {
					const srt = v.find((x) => x.ext == "srt") ?? v[0];
					return srt
						? {
								id: `Auto ${srt.name}`,
								url: srt.url,
								lang: k,
							}
						: null;
				}),
			].filter((srt) => srt !== null),
		});
	} catch (error) {
		logError(error);
		return reply.send({ subtitles: [] });
	}
});

// Configuration Page
async function configurationPage(req, reply) {
	/** @type {Object} */
	let userConfig = {};
	try {
		userConfig = req.params.config
			? decryptConfig(req.params.config, false)
			: {};
	} catch (error) {
		logError(error);
	}
	const catalogType = JSON.stringify(
		userConfig.catalogType ?? defaultConfig.catalogType,
	);
	return reply.type("text/html").send(`
        <!DOCTYPE html>
        <html>
        <head>
            <link rel="icon" href="https://github.com/xXCrash2BomberXx/YouTubio/blob/${process.env.DEV_LOGGING ? "main" : `v${VERSION}`}/icon.png?raw=true">
            <title>YouTubio | ElfHosted</title>
            <link href="https://fonts.googleapis.com/css2?family=Ubuntu&display=swap" rel="stylesheet">
            <style>
                body { font-family: 'Ubuntu', Helvetica, Arial, sans-serif; text-align: center; padding: 2rem; background: #f4f4f8; color: #333; }
                .container { max-width: 50rem; margin: auto; background: white; padding: 2rem; border-radius: 1rem; }
                h1 { color: #d92323; }
                textarea { width: 100%; height: 15rem; padding: 1rem; border-radius: 1rem; border: 0.1rem solid #ccc; box-sizing: border-box; resize: vertical; }
                th, td { border: 0.1rem solid #ccc; padding: 1rem; text-align: left; }
                input { width: 100%; box-sizing: border-box; }
                .install-button { margin-top: 1rem; border-width: 0; display: inline-block; padding: 0.5rem; background-color: #5835b0; color: white; border-radius: 0.2rem; cursor: pointer; }
                .install-button:hover { background-color: #4a2c93; }
                .install-button:disabled { background-color: #ccc; cursor: not-allowed; }
                .error { color: #d92323; margin-top: 1rem; }
                .settings-section { text-align: left; margin-top: 2rem; padding: 1rem; border: 0.1rem solid #ddd; border-radius: 1rem; background: #f9f9f9; }
                .toggle-container { display: flex; align-items: center; margin: 1rem 0; }
                .toggle-container input[type="checkbox"] { margin-right: 1rem; }
                .toggle-container label { cursor: pointer; }
                .setting-description { color: #666; }
                @media (prefers-color-scheme: dark) {
                    body { background: #121212; color: #e0e0e0; }
                    .container { background: #1e1e1e; }
                    textarea, input, select {
                        background: #2a2a2a;
                        color: #e0e0e0;
                        border: 0.1rem solid #555;
                    }
                    th, td { border: 0.1rem solid #555; }
                    .install-button { background-color: #6a5acd; }
                    .install-button:hover { background-color: #5941a9; }
                    .install-button:disabled { background-color: #555; }
                    .settings-section { background: #1e1e1e; border: 0.1rem solid #333; }
                    .setting-description { color: #aaa; }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div style="display: flex; justify-content: center; margin: 1rem; align-items: center;">
                    <img src="https://github.com/xXCrash2BomberXx/YouTubio/blob/${process.env.DEV_LOGGING ? "main" : `v${VERSION}`}/icon.png?raw=true" alt="YouTubio">
                    <h1 style="position: relative; top: 96px; left: -80px; font-size: 32px;">ElfHosted</h1>
                </div>
                <h3 style="color: #f5a623;">v${VERSION}</h3>
                ${process.env.EMBED ?? ""}
                For a quick setup guide, go to <a href="https://github.com/xXCrash2BomberXx/YouTubio#%EF%B8%8F-quick-setup-with-cookies" target="_blank" rel="noopener noreferrer">github.com/xXCrash2BomberXx/YouTubio</a>
                <form id="config-form">
                    <div class="settings-section">
                        <details style="text-align: center;">
                            <summary>
                                This addon supports FAR more than just YouTube with URLs!<br>
                                <a href="https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md" target="_blank" rel="noopener noreferrer">Read more here.</a>
                            </summary>
                            ${process.env.YTDLP_EXTRACTORS_EMBED ?? ""}
                            <div style="max-height: 20rem; overflow: auto;">
                                ${await supportedWebsites}
                            </div>
                        </details>
                    </div>
                    <div class="settings-section">
                        <h3>Cookies</h3>
                        <hr>
                        <textarea id="cookie-data" placeholder="Paste the content of your cookies.txt file here..."${userConfig.encrypted ? ` disabled>${userConfig.encrypted ?? ""}` : ">"}</textarea>
                        <h3>Gemini API Key</h3>
                        <hr>
                        <input type="text" id="gemini" name="gemini" placeholder="Enter your Gemini API key here..."${userConfig.encrypted ? " disabled" : ""}>
                        <button type="button" class="install-button" id="clear-cookies">Clear</button>
                    </div>
                    <div class="settings-section">
                        <h3>Playlists</h3>
                        <hr>
                        <details>
                            <summary>Advanced Usage</summary>
                            <p>
                                &#128712;
                                <b>Search Type</b> determines how the backend interprets the <b>Playlist ID / URL</b>.
                                <ul style="margin-top: 0; font-size: small;">
                                    <li><b>Auto</b>: The backend will attempt to determine the type of the input automatically.</li>
                                    <li><b>Video</b>: Treats the <b>Playlist ID / URL</b> as though it were typed directly into the YouTube search bar.</li>
                                    <li><b>Channel</b>: Treats the <b>Playlist ID / URL</b> as though it were typed directly into the YouTube search bar with the channel filter enabled.</li>
                                </ul>
                            </p>
                            <p>
                                &#128712;
                                You can use <b><code>${termKeyword}</code></b> in the <b>Playlist ID / URL</b> for custom search catalogs in places the encoded URI search component is used.
                                ex. <code>https://www.youtube.com/results?search_query=example+search</code> &rarr; <code>https://www.youtube.com/results?search_query=${termKeyword}</code>
                            </p>
                            <p>
                                &#128712;
                                You can use <b><code>${sortKeyword}</code></b> in the <b>Playlist ID / URL</b> for custom sort order in places the encoded URI sorting component is used.
                                ex. <code>https://www.youtube.com/results?search_query=example+search&sp=CAASAhAC</code> &rarr; <code>https://www.youtube.com/results?search_query=${termKeyword}${sortKeyword}</code> &amp; Sort ID: <code>&sp=CAASAhAC</code>, Sort Name: <code>Channel</code>
                            </p>
                            <hr>
                        </details>
                        <div style="margin-bottom: 1rem;">
                            <button type="button" id="add-defaults" class="install-button">Add Defaults</button>
                            <button type="button" id="remove-defaults" class="install-button">Remove Defaults</button>
                            <button type="button" id="add-accounts" class="install-button">Load from YouTube</button>
                            <button type="button" id="add-playlist" class="install-button">Add Playlist</button>
                        </div>
                        <table id="playlist-table" style="width:100%;border-collapse:collapse;">
                            <thead>
                                <tr>
                                    <th>Type</th>
                                    <th>Playlist ID / URL</th>
                                    <th>Catalog Name</th>
                                    <th>Search Type</th>
                                    <th>Sort Order</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </div>
                    <div class="settings-section" id="addon-settings">
                        <h3>Settings</h3>
                        <hr>
                        <table>
                            <thead>
                                <tr>
                                    <th>Value</th>
                                    <th>Setting</th>
                                    <th>Description</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${process.env.NO_DEARROW ? "<!--" : ""}
                                <tr>
                                    <td><input type="checkbox" id="dearrow" name="dearrow" data-default=0 ${userConfig.dearrow ? "checked" : ""}></td>
                                    <td><label for="dearrow">DeArrow</label></td>
                                    <td class="setting-description">Use DeArrow to fetch video thumbnails and Titles.</td>
                                </tr>
                                ${process.env.NO_DEARROW ? "-->" : ""}
                                ${process.env.NO_SPONSORBLOCK ? "<!--" : ""}
                                <tr>
                                    <td>
                                        <select name="sponsorblock" id="sponsorblock" multiple>
                                            <option value="sponsor" ${userConfig.sponsorblock?.includes("sponsor") ? "selected" : ""}>Sponsor</option>
                                            <option value="selfpromo" ${userConfig.sponsorblock?.includes("selfpromo") ? "selected" : ""}>Self Promo</option>
                                            <option value="interaction" ${userConfig.sponsorblock?.includes("interaction") ? "selected" : ""}>Interaction</option>
                                            <option value="intro" ${userConfig.sponsorblock?.includes("intro") ? "selected" : ""}>Intro</option>
                                            <option value="outro" ${userConfig.sponsorblock?.includes("outro") ? "selected" : ""}>Outro</option>
                                            <option value="preview" ${userConfig.sponsorblock?.includes("preview") ? "selected" : ""}>Preview</option>
                                            <option value="hook" ${userConfig.sponsorblock?.includes("hook") ? "selected" : ""}>Hook</option>
                                            <option value="filler" ${userConfig.sponsorblock?.includes("filler") ? "selected" : ""}>Filler</option>
                                        </select>
                                    </td>
                                    <td><label for="sponsorblock">SponsorBlock</label></td>
                                    <td class="setting-description">Use SponsorBlock to skip various video segments. (Hold Ctrl/Cmd to select multiple segment types.)</td>
                                </tr>
                                <tr>
                                    <td><input type="checkbox" id="fallback" name="fallback" data-default=1 ${(userConfig.fallback ?? defaultConfig.fallback) ? "checked" : ""}></td>
                                    <td><label for="fallback">SponsorBlock Fallback</label></td>
                                    <td class="setting-description">Fallback to the untrimmed video if trimming results in an error.</td>
                                </tr>
                                <tr>
                                    <td><input type="checkbox" id="overestimate" name="overestimate" data-default=0 ${(userConfig.overestimate ?? defaultConfig.overestimate) ? "checked" : ""}></td>
                                    <td><label for="overestimate">Overestimate SponsorBlock Segments</label></td>
                                    <td class="setting-description">Overestimate trimming of SponsorBlock segments.</td>
                                </tr>
                                ${process.env.NO_SPONSORBLOCK ? "-->" : ""}
                                <tr>
                                    <td><input type="checkbox" id="markWatchedOnLoad" name="markWatchedOnLoad" data-default=0 ${(userConfig.markWatchedOnLoad ?? defaultConfig.markWatchedOnLoad) ? "checked" : ""}></td>
                                    <td><label for="markWatchedOnLoad">Mark Watched</label></td>
                                    <td class="setting-description">Mark videos as watched in your YouTube history when you open them in Stremio. This helps keep your YouTube watch history synchronized. (This disables caching.)</td>
                                </tr>
                                <tr>
                                    <td><input type="checkbox" id="showBrokenLinks" name="showBrokenLinks" data-default=0 ${(userConfig.showBrokenLinks ?? defaultConfig.showBrokenLinks) ? "checked" : ""}></td>
                                    <td><label for="showBrokenLinks">Show Unsupported Streams</label></td>
                                    <td class="setting-description">Return all streams found by YT-DLP, not just ones supported by Stremio.</td>
                                </tr>
                                <tr>
                                    <td><input type="checkbox" id="search" name="search" data-default=1 ${(userConfig.search ?? defaultConfig.search) ? "checked" : ""}></td>
                                    <td><label for="search">Add YouTube Search</label></td>
                                    <td class="setting-description">Add a default YouTube search catalog for videos and channels.</td>
                                </tr>
                                <tr>
                                    <td><input type="text" id="catalogType" name="catalogType" data-default=${JSON.stringify(defaultConfig.catalogType)} value=${catalogType} style="width: 5rem;"></td>
                                    <td><label for="catalogType">YouTube Search Type</label></td>
                                    <td class="setting-description">Specify the fallback type name of catalogs.</td>
                                </tr>
                                <tr>
                                    <td><input type="text" id="geminiModel" name="geminiModel" data-default=${JSON.stringify(defaultConfig.geminiModel)} value=${JSON.stringify(userConfig.geminiModel ?? defaultConfig.geminiModel)} style="width: 5rem;"></td>
                                    <td><label for="geminiModel">Gemini Model</label></td>
                                    <td class="setting-description">Specify the Gemini model to use for AI features.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <button type="submit" class="install-button" id="submit-btn">Generate Install Link</button>
                    <div id="error-message" class="error" style="display:none;"></div>
                </form>
                <div id="results" style="display:none;">
                    <h2>Install your addon</h2>
                    <a href="#" target="_blank" id="install-stremio" class="install-button">Stremio</a>
                    <a href="#" target="_blank" id="install-web" class="install-button">Stremio Web</a>
                    <a id="copy-btn" class="install-button">Copy URL</a>
                    <a href="#" id="reload" class="install-button">Reload</a>
                    <input type="text" id="install-url" style="display: none;" readonly class="url-input">
                </div>
            </div>
            <script>
                const cookies = document.getElementById('cookie-data');
                const gemini = document.getElementById('gemini');
                const addAccounts = document.getElementById('add-accounts')
                const addDefaults = document.getElementById('add-defaults');
                const addonSettings = document.getElementById('addon-settings');
                const submitBtn = document.getElementById('submit-btn');
                const errorDiv = document.getElementById('error-message');
                const resultsDiv = document.getElementById('results');
                function encodeConfig(config) {
                    const bytes = new TextEncoder().encode(JSON.stringify(config));
                    let binary = '';
                    for (const byte of bytes) binary += String.fromCharCode(byte);
                    return 'c2.' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
                }
                function configChanged() {
                    resultsDiv.style.display = 'none';
                    addDefaults.disabled = cookies.value.length <= 0;
                    addAccounts.disabled = addDefaults.disabled;
                }
                const installStremio = document.getElementById('install-stremio');
                const installWeb = document.getElementById('install-web');
                const reload = document.getElementById('reload');
                const installUrlInput = document.getElementById('install-url');
                const playlistTableBody = document.querySelector('#playlist-table tbody');
                const defaultPlaylists = [
                    { type: ${catalogType}, id: ':ytrec', name: 'Discover', channelType: 'auto' },
                    { type: ${catalogType}, id: ':ytsubs', name: 'Subscriptions', channelType: 'auto' },
                    { type: ${catalogType}, id: ':ytwatchlater', name: 'Watch Later', channelType: 'auto' },
                    { type: ${catalogType}, id: ':ythistory', name: 'History', channelType: 'auto' }
                ];
                let playlists = ${JSON.stringify(
									userConfig.catalogs?.map((pl) => ({
										...pl,
										id: pl.id.startsWith(prefix)
											? pl.id.slice(prefix.length)
											: pl.id,
									})) ?? [],
								)};
                document.getElementById('clear-cookies').addEventListener('click', () => {
                    cookies.value = "";
                    cookies.disabled = false;
                    gemini.value = "";
                    gemini.disabled = false;
                    configChanged();
                });
                cookies.addEventListener('input', configChanged);
                gemini.addEventListener('input', configChanged);
                addonSettings.querySelectorAll("input, select").forEach(e => e.addEventListener('change', configChanged));
                function makeActions(callback, array, index) {
                    const actionsCell = document.createElement('td');
                    const upBtn = document.createElement('button');
                    upBtn.textContent = '↑';
                    upBtn.classList.add('install-button');
                    upBtn.style.margin = '0.2rem';
                    upBtn.addEventListener('click', () => {
                        if (index > 0) {
                            [array[index - 1], array[index]] = [array[index], array[index - 1]];
                            callback();
                        }
                    });
                    const downBtn = document.createElement('button');
                    downBtn.textContent = '↓';
                    downBtn.classList.add('install-button');
                    downBtn.style.margin = '0.2rem';
                    downBtn.addEventListener('click', () => {
                        if (index < array.length - 1) {
                            [array[index + 1], array[index]] = [array[index], array[index + 1]];
                            callback();
                        }
                    });
                    const removeBtn = document.createElement('button');
                    removeBtn.textContent = 'Remove';
                    removeBtn.classList.add('install-button');
                    removeBtn.style.margin = '0.2rem';
                    removeBtn.addEventListener('click', () => {
                        array.splice(index, 1);
                        callback();
                    });
                    actionsCell.appendChild(upBtn);
                    actionsCell.appendChild(downBtn);
                    actionsCell.appendChild(removeBtn);
                    return actionsCell;
                }
                function renderPlaylists() {
                    playlistTableBody.innerHTML = '';
                    playlists.forEach((pl, index) => {
                        const row = document.createElement('tr');
                        // Type
                        const typeCell = document.createElement('td');
                        const typeInput = document.createElement('input');
                        typeInput.value = pl.type;
                        typeInput.addEventListener('input', () => {
                            pl.type = typeInput.value.trim();
                            configChanged();
                        });
                        typeCell.appendChild(typeInput);
                        // ID
                        const idCell = document.createElement('td');
                        const idInput = document.createElement('input');
                        idInput.value = pl.id;
                        idInput.required = true;
                        idInput.addEventListener('change', () => {
                            pl.id = idInput.value;
                            configChanged();
                        });
                        idCell.appendChild(idInput);
                        // Name
                        const nameCell = document.createElement('td');
                        const nameInput = document.createElement('input');
                        nameInput.value = pl.name;
                        nameInput.required = true;
                        nameInput.addEventListener('input', () => {
                            pl.name = nameInput.value.trim();
                            configChanged();
                        });
                        nameCell.appendChild(nameInput);
                        // Search Type
                        const channelTypeCell = document.createElement('td');
                        const channelTypeInput = document.createElement('select');
                        ${JSON.stringify(channelTypeArray)}.forEach((type, index) => {
                            const option = document.createElement('option');
                            option.value = index;
                            option.textContent = type.charAt(0).toUpperCase() + type.slice(1);
                            channelTypeInput.appendChild(option);
                        });
                        channelTypeInput.defaultValue = 0;
                        channelTypeInput.addEventListener('change', () => {
                            pl.channelType = channelTypeInput.value;
                            configChanged();
                        });
                        channelTypeCell.appendChild(channelTypeInput);
                        // Sort Order
                        pl.sortOrder = pl.sortOrder ?? [];
                        const sortOrderCell = document.createElement('td');
                        const sortOrderInput = document.createElement('button');
                        sortOrderInput.textContent = 'Modify';
                        sortOrderInput.title = 'Requires Playlist ID / URL to contain \\'${sortKeyword}\\'';
                        sortOrderInput.classList.add('install-button');
                        sortOrderInput.type = 'button';
                        sortOrderInput.addEventListener('click', () => {
                            if (!idInput.value?.includes(${JSON.stringify(sortKeyword)})) return;
                            const sorts = JSON.parse(JSON.stringify(pl.sortOrder));
                            function renderSorts() {
                                tbody.innerHTML = '';
                                sorts.forEach((s, index) => {
                                    const row = document.createElement('tr');
                                    const idCell = document.createElement('td');
                                    const idInput = document.createElement('input');
                                    idInput.required = true;
                                    idInput.addEventListener('change', () => s.id = idInput.value);
                                    idInput.value = s.id;
                                    const nameCell = document.createElement('td');
                                    const nameInput = document.createElement('input');
                                    nameInput.required = true;
                                    nameInput.addEventListener('change', () => s.name = nameInput.value);
                                    nameInput.value = s.name;
                                    idCell.appendChild(idInput);
                                    row.appendChild(idCell);
                                    nameCell.appendChild(nameInput);
                                    row.appendChild(nameCell);
                                    row.appendChild(makeActions(renderSorts, sorts, index));
                                    tbody.appendChild(row);
                                });
                            }
                            const blur = document.createElement('div');
                            blur.style.position = 'fixed';
                            blur.style.top = 0;
                            blur.style.left = 0;
                            blur.style.right = 0;
                            blur.style.bottom = 0;
                            blur.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
                            blur.addEventListener('click', e => {
                                e.preventDefault();
                                e.stopPropagation();
                            });
                            const modal = document.createElement('form');
                            modal.style.position = 'fixed';
                            modal.style.top = '50%';
                            modal.style.left = '50%';
                            modal.style.transform = 'translate(-50%, -50%)';
                            modal.classList.add('settings-section');
                            function closeModal(save = false) {
                                if (save) pl.sortOrder = sorts;
                                document.body.removeChild(blur);
                                document.body.removeChild(modal);
                            }
                            const title = document.createElement('h3');
                            title.textContent = 'Modify Sort Order';
                            const sortButtons = document.createElement('div');
                            sortButtons.style.marginBottom = '1rem';
                            const addSort = document.createElement('button');
                            addSort.type = 'button';
                            addSort.textContent = 'Add Sort';
                            addSort.classList.add('install-button');
                            addSort.addEventListener('click', () => {
                                sorts.push({ id: '', name: '' });
                                renderSorts();
                            });
                            const saveBtn = document.createElement('button');
                            saveBtn.type = 'submit';
                            saveBtn.textContent = 'Save';
                            saveBtn.classList.add('install-button');
                            modal.addEventListener('submit', () => {
                                closeModal(true);
                                configChanged();
                            });
                            const cancelBtn = document.createElement('button');
                            cancelBtn.textContent = 'Cancel';
                            cancelBtn.classList.add('install-button');
                            cancelBtn.addEventListener('click', () => closeModal(false));
                            const table = document.createElement('table');
                            table.style.width = '100%';
                            table.style.borderCollapse = 'collapse';
                            const thead = document.createElement('thead');
                            const headerRow = document.createElement('tr');
                            const thID = document.createElement('th');
                            thID.textContent = 'Sort ID';
                            const thName = document.createElement('th');
                            thName.textContent = 'Sort Name';
                            const thActions = document.createElement('th');
                            thActions.textContent = 'Actions';
                            const tbody = document.createElement('tbody');
                            renderSorts();
                            document.body.appendChild(blur);
                            headerRow.appendChild(thID);
                            headerRow.appendChild(thName);
                            headerRow.appendChild(thActions);
                            modal.appendChild(title);
                            modal.appendChild(document.createElement('hr'));
                            sortButtons.appendChild(addSort);
                            sortButtons.appendChild(saveBtn);
                            sortButtons.appendChild(cancelBtn);
                            modal.appendChild(sortButtons);
                            thead.appendChild(headerRow);
                            table.appendChild(thead);
                            table.appendChild(tbody);
                            modal.appendChild(table);
                            document.body.appendChild(modal);
                        });
                        sortOrderCell.appendChild(sortOrderInput);
                        row.appendChild(typeCell);
                        row.appendChild(idCell);
                        row.appendChild(nameCell);
                        row.appendChild(channelTypeCell);
                        row.appendChild(sortOrderCell);
                        row.appendChild(makeActions(renderPlaylists, playlists, index));
                        playlistTableBody.appendChild(row);
                    });
                    configChanged();
                }
                document.getElementById('add-playlist').addEventListener('click', () => {
                    playlists.push({ type: ${catalogType}, id: '', name: '', channelType: 'auto' });
                    renderPlaylists();
                });
                addAccounts.addEventListener('click', async e => {
                    const originalDisabled = e.target.disabled;
                    e.target.disabled = true;
                    if (!reload.href.endsWith('configure'))
                        await populateInstall();
                    (await (await fetch(reload.href.replace(/configure$/, 'playlists'))).json()).forEach(p =>
                        playlists.push({ type: ${catalogType}, id: p.id, name: p.name, channelType: 'auto' })
                    );
                    renderPlaylists();
                    e.target.disabled = originalDisabled;
                });
                addDefaults.addEventListener('click', () => {
                    playlists = [...playlists, ...defaultPlaylists];
                    renderPlaylists();
                });
                document.getElementById('remove-defaults').addEventListener('click', () => {
                    playlists = playlists.filter(pl => !defaultPlaylists.some(def => def.id === pl.id));
                    renderPlaylists();
                });
                renderPlaylists();
                async function populateInstall(event) {
                    event?.preventDefault();
                    submitBtn.disabled = true;
                    const originalText = submitBtn.textContent
                    submitBtn.textContent = 'Encrypting...';
                    errorDiv.style.display = 'none';
                    try {
                        // Encrypt the sensitive data
                        if ((cookies.value && !cookies.disabled) || (gemini.value && !gemini.disabled))
                            cookies.value = await (await fetch('/encrypt', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    auth: cookies.value,
                                    gemini: gemini.value
                                })
                            })).text();
                        cookies.disabled = true;
                        gemini.disabled = true;
                        const modifiedPlaylists = playlists.map(pl => ({
                            ...pl,
                            id: ${JSON.stringify(prefix)} + pl.id,
                            ...(pl.sortOrder?.length ? { sortOrder: pl.sortOrder } : {})
                        }));
                        const configPath = \`/\${encodeConfig({
                            ...(cookies.value ? {encrypted: cookies.value} : {}),
                            ...(modifiedPlaylists.length ? { catalogs: modifiedPlaylists } : {}),
                            // Non-Sensitive Settings
                            ...Object.fromEntries(
                                Array.from(addonSettings.querySelectorAll("input, select"))
                                    .map(x => {
                                        if (x.type === 'select-multiple') {
                                            const value = Array.from(x.selectedOptions).map(o => o.value);
                                            return value.length ? [x.name, value] : null;
                                        }
                                        const value = x.type === 'checkbox' ? (x.checked ? 1 : 0) : x.value;
                                        return value != x.dataset.default ? [x.name, value] : null;
                                    }).filter(x => x !== null)
                            )
                        })}/\`;
                        const manifestPath = configPath + 'manifest.json';
                        installStremio.href = \`stremio://\${window.location.host}\${manifestPath}\`;
                        reload.href = window.location.origin + configPath + 'configure';
                        installUrlInput.value = window.location.origin + manifestPath;
                        installWeb.href = \`https://web.stremio.com/#/addons?addon=\${encodeURIComponent(installUrlInput.value)}\`;
                        resultsDiv.style.display = 'block';
                    } catch (error) {
                        errorDiv.textContent = error.message;
                        errorDiv.style.display = 'block';
                    } finally {
                        submitBtn.disabled = false;
                        submitBtn.textContent = originalText;
                    }
                }
                document.getElementById('config-form').addEventListener('submit', populateInstall);
                document.getElementById('copy-btn').addEventListener('click', async function() {
                    await navigator.clipboard.writeText(installUrlInput.value);
                    this.textContent = 'Copied!';
                    setTimeout(() => { this.textContent = 'Copy URL'; }, 2000);
                });
            </script>
        </body>
        </html>
    `);
}

app.get("/", configurationPage);
app.get("/:config/configure", configurationPage);

// Error Handling Middleware
app.setErrorHandler((error, req, reply) => {
	logError(error);
	if (!reply.sent)
		reply
			.code(500)
			.send({ error: "Internal server error", message: error.message });
});

closeWithGrace(async ({ err }) => {
	if (err) console.error(err);
	await app.close();
});

// Start the Server
app
	.listen({ port: Number(PORT), host: "0.0.0.0" })
	.then(() => {
		console.log(`Addon server v${VERSION} running on port ${PORT}`);
		if (!hasEncryptionKey) {
			console.warn(
				"WARNING: Using random encryption key. Set ENCRYPTION_KEY environment variable for production.",
			);
			if (process.env.DEV_LOGGING)
				console.warn(
					"Generated key (base64):",
					encryptionKey.toString("base64"),
				);
		}
		console.log(
			`Access the configuration page at: ${process.env.SPACE_HOST ? "https://" + process.env.SPACE_HOST : "http://localhost:" + PORT}`,
		);
	})
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
