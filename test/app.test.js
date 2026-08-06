const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { buildApp } = require("../src/app");

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

test("handles CORS preflight through inject", async () => {
	const response = await app.inject({ method: "OPTIONS", url: "/" });

	assert.equal(response.statusCode, 204);
	assert.equal(response.headers["access-control-allow-origin"], "*");
});
