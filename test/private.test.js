const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

const directory = fs.mkdtempSync(
	path.join(os.tmpdir(), "youtubio-private-test-"),
);
process.env.CONFIG_DB_PATH = path.join(directory, "configs.sqlite");
process.env.PRIVATE_MODE = "1";
process.env.PRIVATE_MODE_PASSWORD = crypto
	.randomBytes(24)
	.toString("base64url");

const { buildApp } = require("../src/app");
const app = buildApp();

before(async () => app.ready());
after(async () => {
	await app.close();
	fs.rmSync(directory, { recursive: true, force: true });
});

test("private mode gates both installation and existing addon endpoints", async () => {
	const login = await app.inject({ method: "GET", url: "/" });
	assert.equal(login.statusCode, 200);
	assert.match(login.body, /type="password"/);
	assert.match(login.body, /<img src="\/icon.png" alt="YouTubio">/);
	const icon = await app.inject({ method: "GET", url: "/icon.png" });
	assert.equal(icon.statusCode, 200);
	assert.match(icon.headers["content-type"], /^image\/png/);
	for (const url of [
		"/c2.e30/manifest.json",
		"/s3.fake/manifest.json",
		"/stream/anything",
	]) {
		const response = await app.inject({ method: "GET", url });
		assert.equal(response.statusCode, 401);
	}
	for (const url of ["/configs", "/encrypt"]) {
		const response = await app.inject({ method: "POST", url, payload: {} });
		assert.equal(response.statusCode, 401);
	}
});

test("password issues a per-install token that can be revoked", async () => {
	const incorrect = await app.inject({
		method: "POST",
		url: "/private/unlock",
		payload: { password: "wrong password" },
	});
	assert.equal(incorrect.statusCode, 401);

	const unlocked = await app.inject({
		method: "POST",
		url: "/private/unlock",
		payload: { password: process.env.PRIVATE_MODE_PASSWORD },
	});
	assert.equal(unlocked.statusCode, 200);
	const { token } = unlocked.json();
	assert.match(token, /^[A-Za-z0-9_-]{43}$/);

	const setup = await app.inject({
		method: "GET",
		url: `/private/setup/${token}`,
	});
	assert.equal(setup.statusCode, 200);
	assert.match(setup.body, /Save Configuration & Generate Link/);
	const script = setup.body.match(/<script>([\s\S]*?)<\/script>/)?.[1];
	assert.ok(script);
	assert.doesNotThrow(() => new Function(script));

	const saved = await app.inject({
		method: "POST",
		url: "/configs",
		headers: { authorization: `Bearer ${token}` },
		payload: {},
	});
	assert.equal(saved.statusCode, 201);
	assert.equal(
		fs.readFileSync(process.env.CONFIG_DB_PATH).includes(Buffer.from(token)),
		false,
	);
	const config = `p1.${token}.${saved.json().id}`;
	const manifest = await app.inject({
		method: "GET",
		url: `/${config}/manifest.json`,
	});
	assert.equal(manifest.statusCode, 200);
	assert.equal(manifest.json().id, "youtubio.elfhosted.com");
	const edit = await app.inject({ method: "GET", url: `/${config}/configure` });
	assert.equal(edit.statusCode, 200);
	assert.match(edit.body, /Revoke this access token/);

	const revoked = await app.inject({
		method: "POST",
		url: "/private/revoke",
		headers: { authorization: `Bearer ${token}` },
	});
	assert.equal(revoked.statusCode, 204);
	assert.equal(
		(await app.inject({ method: "GET", url: `/${config}/manifest.json` }))
			.statusCode,
		401,
	);
});
