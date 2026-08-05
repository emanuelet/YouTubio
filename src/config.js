const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { channelTypeArray } = require("./constants");

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  ? Buffer.from(process.env.ENCRYPTION_KEY, "base64")
  : crypto.randomBytes(32);
const ALGORITHM = "aes-256-gcm";

function encryptionKey(salt) {
  return crypto
    .createHash("sha256")
    .update(Buffer.concat([ENCRYPTION_KEY, salt]))
    .digest();
}

function encrypt(text) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(salt), iv);
  const encrypted = Buffer.concat([
    cipher.update(zlib.deflateRawSync(text)),
    cipher.final(),
  ]);
  return `v2:${Buffer.concat([salt, iv, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
}

function decrypt(encryptedData) {
  if (encryptedData.startsWith("v2:")) {
    const payload = Buffer.from(encryptedData.slice(3), "base64url");
    if (payload.length <= 44) throw new Error("Invalid encrypted data format");
    const salt = payload.subarray(0, 16);
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      encryptionKey(salt),
      payload.subarray(16, 28),
    );
    decipher.setAuthTag(payload.subarray(28, 44));
    return zlib
      .inflateRawSync(
        Buffer.concat([
          decipher.update(payload.subarray(44)),
          decipher.final(),
        ]),
        { maxOutputLength: 4 * 1024 * 1024 },
      )
      .toString("utf8");
  }

  const parts = encryptedData.split(":");
  if (parts.length !== 4) throw new Error("Invalid encrypted data format");
  const salt = Buffer.from(parts[0], "hex");
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    encryptionKey(salt),
    Buffer.from(parts[1], "hex"),
  );
  decipher.setAuthTag(Buffer.from(parts[2], "hex"));
  let decrypted = decipher.update(parts[3], "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function decryptConfig(encryptedConfig, enableDecryption = true) {
  const config =
    typeof encryptedConfig === "string"
      ? JSON.parse(
          encryptedConfig.startsWith("c2.")
            ? Buffer.from(encryptedConfig.slice(3), "base64url").toString(
                "utf8",
              )
            : encryptedConfig,
        )
      : encryptedConfig;
  if (enableDecryption && typeof config.encrypted === "string") {
    try {
      config.encrypted = JSON.parse(decrypt(config.encrypted));
    } catch {
      delete config.encrypted;
    }
  }
  if (typeof encryptedConfig === "string")
    config.catalogs?.forEach((catalog) => {
      if (/\d+/.test(catalog.channelType))
        catalog.channelType = channelTypeArray[catalog.channelType];
    });
  return config;
}

module.exports = {
  decryptConfig,
  encrypt,
  encryptionKey: ENCRYPTION_KEY,
  hasEncryptionKey: Boolean(process.env.ENCRYPTION_KEY),
};
