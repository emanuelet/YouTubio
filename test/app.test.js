const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { buildApp } = require("../src/app");
const { encrypt } = require("../src/config");
const { getCacheTTL } = require("../src/ytdlp");

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
});

test("serves the configuration page at the root path", async () => {
	const response = await app.inject({ method: "GET", url: "/" });

	assert.equal(response.statusCode, 200);
	assert.match(response.headers["content-type"], /^text\/html/);
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
