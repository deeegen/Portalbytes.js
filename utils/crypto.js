const crypto = require("crypto");

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;
const BASE_SECRET = process.env.URL_SECRET || "default_secret";

/**
 * Derive a 32-byte AES key from the base secret and the current date (UTC)
 */
function getDailyKey(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  const dateStr = date.toISOString().slice(0, 10); // e.g. "2025-09-15"
  return crypto
    .createHash("sha256")
    .update(BASE_SECRET + dateStr)
    .digest(); // 32 bytes
}

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getDailyKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(encryptedText) {
  const [ivHex, dataHex] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(dataHex, "hex");

  // Try today's key first
  let key = getDailyKey();
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch (e) {
    // Optional: fallback to yesterday's key (grace period around midnight)
    key = getDailyKey(-1);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }
}

module.exports = { encrypt, decrypt };
