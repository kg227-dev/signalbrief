const fs = require("fs");
const path = require("path");

const { qaDebug } = require("./cache-common");

function readArchiveDigest(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    qaDebug(`Skipping invalid archive digest ${path.basename(filePath)}: ${err.message}`);
    return null;
  }
}

function loadArchiveDigests(archiveDir) {
  if (!fs.existsSync(archiveDir)) return [];
  return fs
    .readdirSync(archiveDir)
    .filter((fileName) => /^\d{4}-\d{2}-\d{2}\.json$/.test(fileName))
    .sort()
    .map((fileName) => readArchiveDigest(path.join(archiveDir, fileName)))
    .filter(Boolean);
}

module.exports = {
  loadArchiveDigests,
};
