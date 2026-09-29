const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { buildApp } = require("../src/app");
const { encrypt } = require("../src/config");
const { getCacheTTL, runYtDlpWithAuth } = require("../src/ytdlp");

let app;

before(async () => {
	app = buildApp();
	await app.ready();
});

after(async () => {
	await app.close();
});

test("serves a Stremio manifest through inject", async () => {
	const response = await app.inject({
		method: "GET",
		url: "/c2.e30/manifest.json",
	});

	assert.equal(response.statusCode, 200);
	assert.equal(response.json().id, "youtubio.elfhosted.com");
	assert.equal(response.json().version, "0.14.14");
	assert.equal(response.json().logo, "http://localhost:80/icon.png");
});

test("serves the repository icon as PNG", async () => {
	const response = await app.inject({ method: "GET", url: "/icon.png" });
	assert.equal(response.statusCode, 200);
	assert.match(response.headers["content-type"], /^image\/png/);
	assert.equal(
		response.rawPayload.subarray(0, 8).toString("hex"),
		"89504e470d0a1a0a",
	);
});

test("serves the configuration page at the root path", async () => {
	const response = await app.inject({ method: "GET", url: "/" });

	assert.equal(response.statusCode, 200);
	assert.match(response.headers["content-type"], /^text\/html/);
	assert.match(
		response.body,
		/<details class="settings-section" id="addon-settings">/,
	);
	assert.match(response.body, /Advanced Settings/);
	assert.match(response.body, /Gemini API Key \(Optional\)/);
	assert.match(response.body, /gemini-3\.1-pro-preview/);
});

test("renders a syntactically valid configuration script", async () => {
	const response = await app.inject({ method: "GET", url: "/" });
	const script = response.body.match(/<script>([\s\S]*?)<\/script>/)?.[1];

	assert.ok(script);
	assert.doesNotThrow(() => new Function(script));
});

test("stores encrypted configurations behind opaque IDs", async () => {
	const response = await app.inject({
		method: "POST",
		url: "/configs",
		payload: { encrypted: encrypt(JSON.stringify({ auth: "cookie-value" })) },
	});

	assert.equal(response.statusCode, 201);
	assert.match(response.json().id, /^s3\.[A-Za-z0-9_-]{32}$/);

	const manifest = await app.inject({
		method: "GET",
		url: `/${response.json().id}/manifest.json`,
	});
	assert.equal(manifest.statusCode, 200);
	assert.equal(manifest.json().id, "youtubio.elfhosted.com");
});

test("handles CORS preflight through inject", async () => {
	const response = await app.inject({ method: "OPTIONS", url: "/" });

	assert.equal(response.statusCode, 204);
	assert.equal(response.headers["access-control-allow-origin"], "*");
});

test("uses a short TTL for video search results", () => {
	assert.equal(
		getCacheTTL(
			"https://www.youtube.com/results?search_query=redis&sp=CAASAhAB",
		),
		1200,
	);
});

test("uses a long TTL for channel search results", () => {
	assert.equal(
		getCacheTTL(
			"https://www.youtube.com/results?search_query=redis&sp=CAASAhAC",
		),
		432000,
	);
});

test("public YouTube searches ignore expired cookies without disabling private feeds", async () => {
	const config = {
		encrypted: { auth: "invalid Google cookies" },
		markWatchedOnLoad: true,
	};
	let searchArgs;
	await runYtDlpWithAuth(
		"https://www.youtube.com/results?search_query=hello&sp=CAASAhAB",
		config,
		[],
		undefined,
		async (args) => {
			searchArgs = args;
			return JSON.stringify({ entries: [] });
		},
	);
	assert.equal(searchArgs.includes("--cookies"), false);
	assert.equal(searchArgs.includes("--no-mark-watched"), true);

	let privateArgs;
	await runYtDlpWithAuth(
		":ytwatchlater",
		config,
		[],
		undefined,
		async (args) => {
			privateArgs = args;
			return JSON.stringify({ entries: [] });
		},
	);
	assert.equal(privateArgs.includes("--cookies"), true);
});
