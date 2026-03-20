"use strict";

function createPublicRouteDependencies(deps) {
  const {
    path,
    fs,
    APP_ROOT,
    archiveDir,
    assetVersion,
    readArchiveFilesForDir,
    findUserByToken,
    loadLatestDigestSnapshot,
    loadDigestSnapshotByRunId,
    renderPublicDigestMissingPage,
    formatPublicDigestDateLabel,
    renderPublicDigestPageTemplate,
    getBaseUrl,
    isAdminAuthed,
    serveFile,
    WEB_DIR,
  } = deps;

  return {
    path,
    fs,
    APP_ROOT,
    archiveDir,
    assetVersion,
    readArchiveFiles: readArchiveFilesForDir,
    findUserByToken,
    loadLatestDigestSnapshot,
    loadDigestSnapshotByRunId,
    renderPublicDigestMissingPage,
    formatPublicDigestDateLabel,
    renderPublicDigestPage: (payload) => renderPublicDigestPageTemplate({
      ...payload,
      baseUrl: getBaseUrl(),
    }),
    isAdminAuthed,
    serveFile,
    WEB_DIR,
  };
}

module.exports = {
  createPublicRouteDependencies,
};
