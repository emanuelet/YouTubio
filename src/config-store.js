const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const dbPath =
	process.env.CONFIG_DB_PATH ??
	path.join(
		process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
		"youtubio",
		"configs.sqlite",
	);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath, { timeout: 5000 });
db.exec(`
	CREATE TABLE IF NOT EXISTS configs (
		id TEXT PRIMARY KEY,
		ciphertext TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		expires_at INTEGER NOT NULL
	) STRICT;
	CREATE INDEX IF NOT EXISTS configs_expires_at ON configs(expires_at);
	CREATE TABLE IF NOT EXISTS access_tokens (
		token_hash TEXT PRIMARY KEY,
		expires_at INTEGER NOT NULL
	) STRICT;
	CREATE INDEX IF NOT EXISTS access_tokens_expires_at ON access_tokens(expires_at);
`);

// Keep previously issued install links working, including records created with a TTL.
db.exec(`
	UPDATE configs SET expires_at = 0 WHERE expires_at != 0;
	UPDATE access_tokens SET expires_at = 0 WHERE expires_at != 0;
`);

const insert = db.prepare(
	"INSERT INTO configs (id, ciphertext, created_at, expires_at) VALUES (?, ?, ?, ?)",
);
const get = db.prepare("SELECT ciphertext FROM configs WHERE id = ?");
const insertToken = db.prepare(
	"INSERT INTO access_tokens (token_hash, expires_at) VALUES (?, ?)",
);
const getToken = db.prepare("SELECT 1 FROM access_tokens WHERE token_hash = ?");
const deleteToken = db.prepare(
	"DELETE FROM access_tokens WHERE token_hash = ?",
);

function tokenHash(token) {
	return crypto
		.createHmac("sha256", process.env.PRIVATE_MODE_PASSWORD ?? "")
		.update(token)
		.digest("hex");
}

function createAccessToken() {
	const token = crypto.randomBytes(32).toString("base64url");
	insertToken.run(tokenHash(token), 0);
	return token;
}

function validAccessToken(token) {
	return (
		typeof token === "string" &&
		/^[A-Za-z0-9_-]{43}$/.test(token) &&
		Boolean(getToken.get(tokenHash(token)))
	);
}

function revokeAccessToken(token) {
	deleteToken.run(tokenHash(token));
}

function create(ciphertext) {
	const now = Date.now();
	const id = `s3.${crypto.randomBytes(24).toString("base64url")}`;
	insert.run(id, ciphertext, now, 0);
	return { id };
}

function read(id) {
	return get.get(id)?.ciphertext;
}

function close() {
	db.close();
}

module.exports = {
	close,
	create,
	createAccessToken,
	read,
	revokeAccessToken,
	validAccessToken,
};
