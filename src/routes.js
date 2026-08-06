const VERSION = require("../package.json").version;
const { decryptConfig, encrypt } = require("./config");
const { registerConfigureRoutes } = require("./configure");
const { runYtDlpWithAuth: runYtDlp, supportedWebsites } = require("./ytdlp");

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

module.exports = async function registerRoutes(app) {
	app.log.debug({ module: "routes" }, "registering route plugin");
	const runYtDlpWithAuth = (...args) => runYtDlp(...args, app.log);
	app.addHook("preHandler", async (req) => {
		req.log.debug(
			{ method: req.method, route: req.routeOptions.url },
			"route started",
		);
	});
	app.addHook("onResponse", async (req, reply) => {
		req.log.debug(
			{
				method: req.method,
				route: req.routeOptions.url,
				statusCode: reply.statusCode,
				responseTime: reply.elapsedTime,
			},
			"route completed",
		);
	});
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
		app.log.debug({ integration: "dearrow" }, "fetching branding data");
		if (process.env.NO_DEARROW) throw new Error("DeArrow Error: NO_DEARROW");
		const res = await fetch(
			`https://sponsor.ajay.app/api/branding?videoID=${videoID}`,
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
		app.log.debug({ integration: "gemini" }, "requesting fallback segments");
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
		app.log.debug({ integration: "sponsorblock" }, "fetching segments");
		if (process.env.NO_SPONSORBLOCK)
			throw new Error("SponsorBlock Error: NO_SPONSORBLOCK");
		const res = await fetch(
			`https://sponsor.ajay.app/api/skipSegments?videoID=${videoID}`,
		);
		if (!res.ok) {
			if (res.status !== 404)
				throw new Error(`SponsorBlock Error: ${res.status} ${res.statusText}`);
			return getGeminiSegments(encryptedConfig, toYouTubeURL({}, videoID, {}));
		}
		return res.json();
	}

	app.addHook("onSend", async (_req, reply) => {
		reply.header("Access-Control-Allow-Origin", "*");
		reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
	});

	app.options("*", async (_req, reply) => reply.code(204).send());

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
		app.log.error(
			{ errorType: error.constructor.name },
			"route operation failed",
		);
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
		const channelId = videoId.match(channelRegex)?.groups.id;
		if (channelId) return `https://www.youtube.com/${channelId}/videos`;
		const channelIdFromUrl = videoId.match(channelIDRegex)?.groups.id;
		if (channelIdFromUrl)
			return `https://www.youtube.com/channel/${channelIdFromUrl}/videos`;
		const playlistId = videoId.match(playlistIDRegex)?.groups.id;
		if (playlistId)
			return `https://www.youtube.com/playlist?list=${playlistId}`;
		const videoIdFromUrl = videoId.match(videoIDRegex)?.groups.id;
		if (videoIdFromUrl)
			return `https://www.youtube.com/watch?v=${videoIdFromUrl}`;
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
	function toChannelManifestURL(
		userConfig,
		video,
		manifestUrl,
		protocol,
		useID,
	) {
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
					10,
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
				...[...(video.categories ?? []), ...(video.tags ?? [])].map(
					(genre) => ({
						name: genre,
						category: "Genres",
						url: `${protocol}/search?search=${encodeURIComponent(genre)}`,
					}),
				),
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
			const skip = parseInt(query.skip ?? 0, 10);
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
			const protocol = ref ? `${ref}#` : "stremio://";
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
				behaviorHints: {
					cacheMaxAge: canCache ? (process.env.TTL ?? 3600) : 0,
				},
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
				const date = video.release_date ?? video.upload_date;
				const timestamp = video.release_timestamp ?? video.timestamp;
				const value = timestamp
					? timestamp * 1000
					: date
						? `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}T00:00:00Z`
						: 0;
				return new Date(value).toISOString();
			};
			const released = parseDate(video);
			const manifestUrl = toManifestURL(req);
			const ref = req.headers.referrer;
			const protocol = ref ? `${ref}#` : "stremio://";
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
									if (
										useID &&
										videoIDRegex.test(video2.id) &&
										userConfig.dearrow
									)
										deArrow = await runDeArrow(video2.id);
								} catch (error) {
									logError(error);
								}
								return {
									id: prefix + video2.id,
									title:
										deArrow?.titles[0]?.title ??
										video2.title ??
										"Unknown Title",
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
						: { behaviorHints: { defaultVideoId: `${req.params.id}:1:1` } }),
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
			const protocol = ref ? `${ref}#` : "stremio://";
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
						const srt = v.find((x) => x.ext === "srt") ?? v[0];
						return srt
							? {
									id: srt.name,
									url: srt.url,
									lang: k,
								}
							: null;
					}),
					...Object.entries(video.automatic_captions ?? {}).map(([k, v]) => {
						const srt = v.find((x) => x.ext === "srt") ?? v[0];
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

	app.register(registerConfigureRoutes, {
		VERSION,
		decryptConfig,
		defaultConfig,
		prefix,
		termKeyword,
		sortKeyword,
		channelTypeArray,
		supportedWebsites,
		logError,
	});
};
