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
const ttl = Math.max(
	1,
	Number.parseInt(process.env.CONFIG_TTL_SECONDS ?? "2592000", 10) || 2592000,
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
`);

const deleteExpired = db.prepare("DELETE FROM configs WHERE expires_at <= ?");
const insert = db.prepare(
	"INSERT INTO configs (id, ciphertext, created_at, expires_at) VALUES (?, ?, ?, ?)",
);
const get = db.prepare(
	"SELECT ciphertext FROM configs WHERE id = ? AND expires_at > ?",
);

function create(ciphertext) {
	const now = Date.now();
	const id = `s3.${crypto.randomBytes(24).toString("base64url")}`;
	const expiresAt = now + ttl * 1000;
	deleteExpired.run(now);
	insert.run(id, ciphertext, now, expiresAt);
	return { id, expiresAt };
}

function read(id) {
	const now = Date.now();
	deleteExpired.run(now);
	return get.get(id, now)?.ciphertext;
}

function close() {
	db.close();
}

module.exports = { close, create, read };
