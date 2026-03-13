"use strict";

function createPublicRouteDependencies(deps) {
  const {
    path,
    fs,
    APP_ROOT,
    assetVersion,
    readArchiveFilesForDir,
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
    assetVersion,
    readArchiveFiles: readArchiveFilesForDir,
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
