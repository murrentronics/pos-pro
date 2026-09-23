/**
 * Recreates android/app/pospro.jks from .env.local.
 * Backs up any existing keystore first. Never prints secrets.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ENV_LOCAL = path.join(ROOT, ".env.local");
const KEYSTORE = path.join(ROOT, "android", "app", "pospro.jks");
const BACKUP = path.join(ROOT, "android", "app", "pospro.jks.bak");

function loadEnvLocal() {
  if (!fs.existsSync(ENV_LOCAL)) {
    console.error("✗  .env.local not found");
    process.exit(1);
  }
  const map = {};
  for (const line of fs.readFileSync(ENV_LOCAL, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) map[key] = val;
  }
  return map;
}

function findKeytool() {
  const jbr = process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "keytool.exe" : "keytool")
    : null;
  const fallback = "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.101-hotspot\\bin\\keytool.exe";
  if (jbr && fs.existsSync(jbr)) return jbr;
  if (fs.existsSync(fallback)) return fallback;
  return process.platform === "win32" ? "keytool.exe" : "keytool";
}

const env = loadEnvLocal();
for (const k of ["KEYSTORE_PASSWORD", "KEY_ALIAS", "KEY_PASSWORD"]) {
  if (!env[k]) {
    console.error(`✗  ${k} missing from .env.local`);
    process.exit(1);
  }
}

const keytool = findKeytool();
const childEnv = { ...process.env, ...env };

if (fs.existsSync(KEYSTORE)) {
  fs.copyFileSync(KEYSTORE, BACKUP);
  fs.unlinkSync(KEYSTORE);
  console.log("✓  Backed up existing keystore to pospro.jks.bak");
}

const gen = spawnSync(keytool, [
  "-genkeypair",
  "-noprompt",
  "-storetype", "PKCS12",
  "-keystore", KEYSTORE,
  "-alias", env.KEY_ALIAS,
  "-keyalg", "RSA",
  "-keysize", "2048",
  "-validity", "10000",
  "-dname", "CN=P.O.S. Pro, OU=Mobile, O=Murrentronics, C=TT",
  "-storepass:env", "KEYSTORE_PASSWORD",
  "-keypass:env", "KEY_PASSWORD",
], { env: childEnv, encoding: "utf8" });

if (gen.status !== 0) {
  if (fs.existsSync(BACKUP) && !fs.existsSync(KEYSTORE)) {
    fs.copyFileSync(BACKUP, KEYSTORE);
    console.error("✗  keytool failed — restored previous keystore");
  }
  if (gen.stderr) process.stderr.write(gen.stderr.replace(env.KEYSTORE_PASSWORD, "***").replace(env.KEY_PASSWORD, "***"));
  process.exit(gen.status || 1);
}

const check = spawnSync(keytool, [
  "-list",
  "-keystore", KEYSTORE,
  "-storepass:env", "KEYSTORE_PASSWORD",
], { env: childEnv, encoding: "utf8" });

if (check.status !== 0) {
  console.error("✗  New keystore could not be opened with .env.local password");
  process.exit(check.status || 1);
}

const aliasOk = (check.stdout || "").toLowerCase().includes(env.KEY_ALIAS.toLowerCase());
if (!aliasOk) {
  console.error(`✗  Keystore opened but alias "${env.KEY_ALIAS}" was not found`);
  process.exit(1);
}

console.log(`✓  Keystore ready (PKCS12, alias ${env.KEY_ALIAS}, 10000-day validity)`);
console.log("   Keep pospro.jks.bak if Play already has a different upload key.");
