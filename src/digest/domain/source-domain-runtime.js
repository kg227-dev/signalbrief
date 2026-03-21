"use strict";

const { normalizeSourcePolicyDomain } = require("../../runtime/source-policy-registry-runtime");

function parseItemUrl(item, opts = {}) {
  const rawUrl = String(item?.url || "").trim();
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl);
  } catch (err) {
    if (typeof opts.onUrlParseError === "function") opts.onUrlParseError(err);
    return null;
  }
}

function normalizeSourceHost(rawHost) {
  const normalized = normalizeSourcePolicyDomain(rawHost);
  if (normalized) return normalized === "youtu.be" ? "youtube.com" : normalized;
  const host = String(rawHost || "").trim().toLowerCase();
  return host === "youtu.be" ? "youtube.com" : "";
}

function parseSourceDomain(item, opts = {}) {
  const parsedUrl = parseItemUrl(item, opts);
  if (parsedUrl) {
    const normalized = normalizeSourceHost(parsedUrl.hostname);
    if (normalized) return normalized;
  }

  const rawSource = String(item?.source || "").trim().toLowerCase();
  if (!rawSource) return "unknown";
  const normalizedSource = normalizeSourceHost(rawSource.replace(/^https?:\/\//, "").split(/[\/\s]/)[0]);
  return normalizedSource || "unknown";
}

function buildDefaultSourceIdentity(sourceDomain) {
  return {
    source_domain: sourceDomain,
    source_platform: null,
    source_identity_key: sourceDomain || "unknown",
    source_identity_scope: "domain",
    source_identity_label: sourceDomain || "unknown",
  };
}

function parseYoutubeIdentity(parsedUrl) {
  const path = String(parsedUrl?.pathname || "").trim();
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) {
    return {
      source_platform: "youtube",
      source_identity_key: "youtube.com",
      source_identity_scope: "platform",
      source_identity_label: "youtube.com",
    };
  }
  const firstSegment = String(segments[0] || "").trim();
  if (firstSegment.startsWith("@")) {
    return {
      source_platform: "youtube",
      source_identity_key: `youtube:${firstSegment.toLowerCase()}`,
      source_identity_scope: "platform_channel",
      source_identity_label: firstSegment,
    };
  }
  if (["channel", "c", "user"].includes(firstSegment) && segments[1]) {
    return {
      source_platform: "youtube",
      source_identity_key: `youtube:${firstSegment}/${String(segments[1]).toLowerCase()}`,
      source_identity_scope: "platform_channel",
      source_identity_label: `${firstSegment}/${segments[1]}`,
    };
  }
  return {
    source_platform: "youtube",
    source_identity_key: "youtube.com",
    source_identity_scope: "platform",
    source_identity_label: "youtube.com",
  };
}

function parseSubstackIdentity(sourceDomain) {
  if (!sourceDomain.endsWith(".substack.com")) return null;
  const publication = sourceDomain.replace(/\.substack\.com$/i, "").trim().toLowerCase();
  if (!publication) return null;
  return {
    source_platform: "substack",
    source_identity_key: `substack:${publication}`,
    source_identity_scope: "platform_publication",
    source_identity_label: publication,
  };
}

function parseMediumIdentity(parsedUrl, sourceDomain) {
  if (sourceDomain.endsWith(".medium.com")) {
    const publication = sourceDomain.replace(/\.medium\.com$/i, "").trim().toLowerCase();
    if (publication) {
      return {
        source_platform: "medium",
        source_identity_key: `medium:${publication}`,
        source_identity_scope: "platform_publication",
        source_identity_label: publication,
      };
    }
  }

  const path = String(parsedUrl?.pathname || "").trim();
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  if (String(segments[0]).startsWith("@")) {
    const handle = String(segments[0]).toLowerCase();
    return {
      source_platform: "medium",
      source_identity_key: `medium:${handle}`,
      source_identity_scope: "platform_author",
      source_identity_label: segments[0],
    };
  }
  if (segments[0] === "publication" && segments[1]) {
    return {
      source_platform: "medium",
      source_identity_key: `medium:publication/${String(segments[1]).toLowerCase()}`,
      source_identity_scope: "platform_publication",
      source_identity_label: segments[1],
    };
  }
  return {
    source_platform: "medium",
    source_identity_key: "medium.com",
    source_identity_scope: "platform",
    source_identity_label: "medium.com",
  };
}

function parseSourceIdentity(item, opts = {}) {
  const sourceDomain = parseSourceDomain(item, opts);
  const parsedUrl = parseItemUrl(item, opts);
  if (!parsedUrl) return buildDefaultSourceIdentity(sourceDomain);

  const normalizedHost = normalizeSourceHost(parsedUrl.hostname) || sourceDomain;
  if (normalizedHost === "youtube.com") {
    return {
      source_domain: sourceDomain,
      ...parseYoutubeIdentity(parsedUrl),
    };
  }
  if (normalizedHost === "medium.com" || normalizedHost.endsWith(".medium.com")) {
    const mediumIdentity = parseMediumIdentity(parsedUrl, normalizedHost);
    if (mediumIdentity) {
      return {
        source_domain: sourceDomain,
        ...mediumIdentity,
      };
    }
  }
  if (normalizedHost === "substack.com" || normalizedHost.endsWith(".substack.com")) {
    const substackIdentity = parseSubstackIdentity(normalizedHost);
    if (substackIdentity) {
      return {
        source_domain: sourceDomain,
        ...substackIdentity,
      };
    }
    return {
      source_domain: sourceDomain,
      source_platform: "substack",
      source_identity_key: "substack.com",
      source_identity_scope: "platform",
      source_identity_label: "substack.com",
    };
  }

  return buildDefaultSourceIdentity(sourceDomain);
}

module.exports = {
  parseSourceDomain,
  parseSourceIdentity,
};
