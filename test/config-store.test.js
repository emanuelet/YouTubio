const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { after, test } = require("node:test");

const directory = fs.mkdtempSync(
	path.join(os.tmpdir(), "youtubio-store-test-"),
);
process.env.CONFIG_DB_PATH = path.join(directory, "configs.sqlite");
process.env.PRIVATE_MODE_PASSWORD = "test-private-mode-password";
const token = crypto.randomBytes(32).toString("base64url");
const tokenHash = crypto
	.createHmac("sha256", process.env.PRIVATE_MODE_PASSWORD)
	.update(token)
	.digest("hex");

const legacy = new DatabaseSync(process.env.CONFIG_DB_PATH);
legacy.exec(`
	CREATE TABLE configs (id TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT;
	CREATE TABLE access_tokens (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL) STRICT;
`);
legacy
	.prepare("INSERT INTO configs VALUES (?, ?, ?, ?)")
	.run("s3.legacy", "saved", 1, 1);
legacy.prepare("INSERT INTO access_tokens VALUES (?, ?)").run(tokenHash, 1);
legacy.close();

const store = require("../src/config-store");
after(() => {
	store.close();
	fs.rmSync(directory, { recursive: true, force: true });
});

test("existing installed configurations and tokens survive their old expiry", () => {
	assert.equal(store.read("s3.legacy"), "saved");
	assert.equal(store.validAccessToken(token), true);
	const created = store.create("new config");
	assert.deepEqual(Object.keys(created), ["id"]);
	assert.equal(store.read(created.id), "new config");
	assert.equal(store.validAccessToken(store.createAccessToken()), true);
});
