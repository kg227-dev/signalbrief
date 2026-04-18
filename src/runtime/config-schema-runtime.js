"use strict";

const DELIVERY_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function pushError(errors, fieldPath, message) {
  errors.push(`${fieldPath}: ${message}`);
}

function expectObject(errors, fieldPath, value) {
  if (isPlainObject(value)) return true;
  pushError(errors, fieldPath, "must be an object");
  return false;
}

function expectNonEmptyString(errors, fieldPath, value) {
  if (isNonEmptyString(value)) return true;
  pushError(errors, fieldPath, "must be a non-empty string");
  return false;
}

function expectPositiveInteger(errors, fieldPath, value, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    pushError(errors, fieldPath, "must be an integer");
    return false;
  }
  if (parsed < min || parsed > max) {
    pushError(errors, fieldPath, `must be between ${min} and ${max}`);
    return false;
  }
  return true;
}

function expectNumberRange(errors, fieldPath, value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    pushError(errors, fieldPath, "must be a number");
    return false;
  }
  if (parsed < min || parsed > max) {
    pushError(errors, fieldPath, `must be between ${min} and ${max}`);
    return false;
  }
  return true;
}

function expectBoolean(errors, fieldPath, value) {
  if (typeof value === "boolean") return true;
  pushError(errors, fieldPath, "must be a boolean");
  return false;
}

function validateTopicEntry(errors, topic, idx, seenTags) {
  const topicPath = `topics[${idx}]`;
  if (!expectObject(errors, topicPath, topic)) return;

  if (!expectNonEmptyString(errors, `${topicPath}.tag`, topic.tag)) return;
  const normalizedTag = String(topic.tag || "").trim().toUpperCase();
  if (seenTags.has(normalizedTag)) {
    pushError(errors, `${topicPath}.tag`, `duplicate tag '${normalizedTag}'`);
  } else {
    seenTags.add(normalizedTag);
  }

  if (!Array.isArray(topic.queries) || topic.queries.length === 0) {
    pushError(errors, `${topicPath}.queries`, "must be a non-empty array");
    return;
  }

  topic.queries.forEach((query, queryIdx) => {
    if (!isNonEmptyString(query)) {
      pushError(errors, `${topicPath}.queries[${queryIdx}]`, "must be a non-empty string");
    }
  });
}

function validateConfigSchema(config) {
  const errors = [];
  if (!expectObject(errors, "config", config)) {
    return { ok: false, errors };
  }

  const user = config.user;
  if (expectObject(errors, "user", user)) {
    expectNonEmptyString(errors, "user.email", user.email);
    if (expectNonEmptyString(errors, "user.deliveryTime", user.deliveryTime)) {
      if (!DELIVERY_TIME_RE.test(String(user.deliveryTime || "").trim())) {
        pushError(errors, "user.deliveryTime", "must match HH:MM (24h)");
      }
    }
    expectNonEmptyString(errors, "user.timezone", user.timezone);
  }

  const digest = config.digest;
  if (expectObject(errors, "digest", digest)) {
    expectPositiveInteger(errors, "digest.itemCount", digest.itemCount, { min: 5, max: 5 });
    if (digest.maxItemsPerTag != null) {
      expectPositiveInteger(errors, "digest.maxItemsPerTag", digest.maxItemsPerTag, { min: 1, max: 10 });
    }
    if (digest.maxItemsPerSourceDomain != null) {
      expectPositiveInteger(errors, "digest.maxItemsPerSourceDomain", digest.maxItemsPerSourceDomain, { min: 1, max: 10 });
    }
    if (digest.maxDiscoveryCandidateShare != null) {
      expectNumberRange(errors, "digest.maxDiscoveryCandidateShare", digest.maxDiscoveryCandidateShare, { min: 0, max: 1 });
    }
    if (digest.trustedSelectionFloor != null && expectObject(errors, "digest.trustedSelectionFloor", digest.trustedSelectionFloor)) {
      const trustedSelectionFloor = digest.trustedSelectionFloor;
      if (trustedSelectionFloor.enabled != null) {
        expectBoolean(errors, "digest.trustedSelectionFloor.enabled", trustedSelectionFloor.enabled);
      }
      if (trustedSelectionFloor.minTrustedItemsPerTopic != null) {
        expectPositiveInteger(errors, "digest.trustedSelectionFloor.minTrustedItemsPerTopic", trustedSelectionFloor.minTrustedItemsPerTopic, { min: 1, max: 5 });
      }
      if (trustedSelectionFloor.activationStrongCandidateCount != null) {
        expectPositiveInteger(errors, "digest.trustedSelectionFloor.activationStrongCandidateCount", trustedSelectionFloor.activationStrongCandidateCount, { min: 1, max: 20 });
      }
      if (trustedSelectionFloor.standardOverrideMargin != null) {
        expectNumberRange(errors, "digest.trustedSelectionFloor.standardOverrideMargin", trustedSelectionFloor.standardOverrideMargin, { min: 0, max: 1 });
      }
    }
    if (digest.backfillUnlockPolicy != null && expectObject(errors, "digest.backfillUnlockPolicy", digest.backfillUnlockPolicy)) {
      const backfillUnlockPolicy = digest.backfillUnlockPolicy;
      if (backfillUnlockPolicy.failureRatio != null) {
        expectNumberRange(errors, "digest.backfillUnlockPolicy.failureRatio", backfillUnlockPolicy.failureRatio, { min: 0, max: 1 });
      }
      if (backfillUnlockPolicy.absoluteFloor != null) {
        expectPositiveInteger(errors, "digest.backfillUnlockPolicy.absoluteFloor", backfillUnlockPolicy.absoluteFloor, { min: 1, max: 10 });
      }
    }
    if (digest.trustGuardrail != null && expectObject(errors, "digest.trustGuardrail", digest.trustGuardrail)) {
      const trustGuardrail = digest.trustGuardrail;
      if (trustGuardrail.minTrustedItemsPerTopic != null) {
        expectPositiveInteger(errors, "digest.trustGuardrail.minTrustedItemsPerTopic", trustGuardrail.minTrustedItemsPerTopic, { min: 1, max: 5 });
      }
      if (trustGuardrail.aspirationalTrustedItemsPerTopic != null) {
        expectPositiveInteger(errors, "digest.trustGuardrail.aspirationalTrustedItemsPerTopic", trustGuardrail.aspirationalTrustedItemsPerTopic, { min: 1, max: 5 });
      }
    }
    if (digest.lookbackHours != null) {
      expectPositiveInteger(errors, "digest.lookbackHours", digest.lookbackHours, { min: 1, max: 168 });
    }
    if (digest.ranking != null && expectObject(errors, "digest.ranking", digest.ranking)) {
      const ranking = digest.ranking;
      if (ranking.primary_version != null) {
        if (!["v1", "v2"].includes(String(ranking.primary_version))) {
          pushError(errors, "digest.ranking.primary_version", "must be one of v1, v2");
        }
      }
      if (ranking.shadow_version != null) {
        if (!(ranking.shadow_version === null || ["v1", "v2"].includes(String(ranking.shadow_version)))) {
          pushError(errors, "digest.ranking.shadow_version", "must be one of v1, v2, null");
        }
      }
      if (ranking.live_topic_tags != null) {
        if (!Array.isArray(ranking.live_topic_tags)) {
          pushError(errors, "digest.ranking.live_topic_tags", "must be an array");
        } else {
          ranking.live_topic_tags.forEach((tag, idx) => {
            if (!isNonEmptyString(tag)) pushError(errors, `digest.ranking.live_topic_tags[${idx}]`, "must be a non-empty string");
          });
        }
      }
      if (ranking.same_domain_penalty != null && expectObject(errors, "digest.ranking.same_domain_penalty", ranking.same_domain_penalty)) {
        if (ranking.same_domain_penalty.enabled != null) {
          expectBoolean(errors, "digest.ranking.same_domain_penalty.enabled", ranking.same_domain_penalty.enabled);
        }
        if (ranking.same_domain_penalty.min_competitive_gap_for_bypass != null) {
          expectNumberRange(errors, "digest.ranking.same_domain_penalty.min_competitive_gap_for_bypass", ranking.same_domain_penalty.min_competitive_gap_for_bypass, { min: 0, max: 1 });
        }
        if (ranking.same_domain_penalty.penalties != null && expectObject(errors, "digest.ranking.same_domain_penalty.penalties", ranking.same_domain_penalty.penalties)) {
          ["second", "third", "fourth_or_more"].forEach((field) => {
            if (ranking.same_domain_penalty.penalties[field] != null) {
              expectNumberRange(errors, `digest.ranking.same_domain_penalty.penalties.${field}`, ranking.same_domain_penalty.penalties[field], { min: 0, max: 1 });
            }
          });
        }
      }
      if (ranking.same_domain_guardrail != null && expectObject(errors, "digest.ranking.same_domain_guardrail", ranking.same_domain_guardrail)) {
        if (ranking.same_domain_guardrail.enabled != null) {
          expectBoolean(errors, "digest.ranking.same_domain_guardrail.enabled", ranking.same_domain_guardrail.enabled);
        }
        if (ranking.same_domain_guardrail.max_per_topic != null) {
          expectPositiveInteger(errors, "digest.ranking.same_domain_guardrail.max_per_topic", ranking.same_domain_guardrail.max_per_topic, { min: 1, max: 5 });
        }
      }
      if (ranking.kill_switch != null && expectObject(errors, "digest.ranking.kill_switch", ranking.kill_switch)) {
        if (ranking.kill_switch.enabled != null) {
          expectBoolean(errors, "digest.ranking.kill_switch.enabled", ranking.kill_switch.enabled);
        }
        if (ranking.kill_switch.action != null && String(ranking.kill_switch.action) !== "fallback_to_v1") {
          pushError(errors, "digest.ranking.kill_switch.action", "must be fallback_to_v1");
        }
        if (ranking.kill_switch.thresholds != null && expectObject(errors, "digest.ranking.kill_switch.thresholds", ranking.kill_switch.thresholds)) {
          const thresholds = ranking.kill_switch.thresholds;
          if (thresholds.min_selection_overlap_pct != null) {
            expectNumberRange(errors, "digest.ranking.kill_switch.thresholds.min_selection_overlap_pct", thresholds.min_selection_overlap_pct, { min: 0, max: 1 });
          }
          if (thresholds.max_trusted_share_drop_pct != null) {
            expectNumberRange(errors, "digest.ranking.kill_switch.thresholds.max_trusted_share_drop_pct", thresholds.max_trusted_share_drop_pct, { min: 0, max: 100 });
          }
          if (thresholds.max_avg_final_rank_drop != null) {
            expectNumberRange(errors, "digest.ranking.kill_switch.thresholds.max_avg_final_rank_drop", thresholds.max_avg_final_rank_drop, { min: 0, max: 1 });
          }
        }
      }
    }
    if (digest.search_budget != null && expectObject(errors, "digest.search_budget", digest.search_budget)) {
      const searchBudget = digest.search_budget;
      if (searchBudget.scheduled != null && expectObject(errors, "digest.search_budget.scheduled", searchBudget.scheduled)) {
        if (searchBudget.scheduled.soft_calls != null) {
          expectPositiveInteger(errors, "digest.search_budget.scheduled.soft_calls", searchBudget.scheduled.soft_calls, { min: 1, max: 200 });
        }
        if (searchBudget.scheduled.hard_calls != null) {
          expectPositiveInteger(errors, "digest.search_budget.scheduled.hard_calls", searchBudget.scheduled.hard_calls, { min: 1, max: 200 });
        }
      }
    }
    if (digest.strict_quality != null && expectObject(errors, "digest.strict_quality", digest.strict_quality)) {
      const strictQuality = digest.strict_quality;
      if (strictQuality.enabled != null) {
        expectBoolean(errors, "digest.strict_quality.enabled", strictQuality.enabled);
      }
      if (strictQuality.freshness_hours_cap != null) {
        expectPositiveInteger(errors, "digest.strict_quality.freshness_hours_cap", strictQuality.freshness_hours_cap, { min: 1, max: 168 });
      }
      if (strictQuality.topic_fit_min != null) {
        expectNumberRange(errors, "digest.strict_quality.topic_fit_min", strictQuality.topic_fit_min, { min: 0, max: 1 });
      }
      if (strictQuality.max_backfills_per_slot != null) {
        expectPositiveInteger(errors, "digest.strict_quality.max_backfills_per_slot", strictQuality.max_backfills_per_slot, { min: 1, max: 5 });
      }
      if (strictQuality.max_exceptions_per_digest != null) {
        expectPositiveInteger(errors, "digest.strict_quality.max_exceptions_per_digest", strictQuality.max_exceptions_per_digest, { min: 0, max: 5 });
      }
      if (strictQuality.allow_tier3_in_thin_pool != null) {
        expectBoolean(errors, "digest.strict_quality.allow_tier3_in_thin_pool", strictQuality.allow_tier3_in_thin_pool);
      }
      if (strictQuality.major_story != null && expectObject(errors, "digest.strict_quality.major_story", strictQuality.major_story)) {
        if (strictQuality.major_story.enabled != null) {
          expectBoolean(errors, "digest.strict_quality.major_story.enabled", strictQuality.major_story.enabled);
        }
        if (strictQuality.major_story.min_cross_source_count != null) {
          expectPositiveInteger(errors, "digest.strict_quality.major_story.min_cross_source_count", strictQuality.major_story.min_cross_source_count, { min: 1, max: 10 });
        }
        if (strictQuality.major_story.escape_hatch_primary_trusted != null) {
          expectBoolean(errors, "digest.strict_quality.major_story.escape_hatch_primary_trusted", strictQuality.major_story.escape_hatch_primary_trusted);
        }
        if (strictQuality.major_story.escape_hatch_high_corroboration != null) {
          expectBoolean(errors, "digest.strict_quality.major_story.escape_hatch_high_corroboration", strictQuality.major_story.escape_hatch_high_corroboration);
        }
      }
      if (strictQuality.ship_ready != null && expectObject(errors, "digest.strict_quality.ship_ready", strictQuality.ship_ready)) {
        if (strictQuality.ship_ready.allow_underfill != null) {
          expectBoolean(errors, "digest.strict_quality.ship_ready.allow_underfill", strictQuality.ship_ready.allow_underfill);
        }
        if (strictQuality.ship_ready.extreme_underfill_item_count != null) {
          expectPositiveInteger(errors, "digest.strict_quality.ship_ready.extreme_underfill_item_count", strictQuality.ship_ready.extreme_underfill_item_count, { min: 1, max: 5 });
        }
        if (strictQuality.ship_ready.extreme_underfill_warn_rate_pct != null) {
          expectNumberRange(errors, "digest.strict_quality.ship_ready.extreme_underfill_warn_rate_pct", strictQuality.ship_ready.extreme_underfill_warn_rate_pct, { min: 0, max: 100 });
        }
        if (strictQuality.ship_ready.anchor_base_score != null) {
          expectNumberRange(errors, "digest.strict_quality.ship_ready.anchor_base_score", strictQuality.ship_ready.anchor_base_score, { min: 0, max: 10 });
        }
        if (strictQuality.ship_ready.anchor_strategic_value != null) {
          expectNumberRange(errors, "digest.strict_quality.ship_ready.anchor_strategic_value", strictQuality.ship_ready.anchor_strategic_value, { min: 0, max: 1 });
        }
      }
    }
  }

  if (!Array.isArray(config.topics) || config.topics.length === 0) {
    pushError(errors, "topics", "must be a non-empty array");
  } else {
    const seenTags = new Set();
    config.topics.forEach((topic, idx) => validateTopicEntry(errors, topic, idx, seenTags));
  }

  const admin = config.admin;
  if (expectObject(errors, "admin", admin)) {
    expectNonEmptyString(errors, "admin.email", admin.email);
    expectNonEmptyString(errors, "admin.salt", admin.salt);
    expectNonEmptyString(errors, "admin.passwordHash", admin.passwordHash);
  }

  const keys = config.keys;
  if (expectObject(errors, "keys", keys)) {
    [
      "perplexity",
      "anthropic",
      "resendApiKey",
      "unsubscribeSigningSecret",
      "fromEmail",
      "fromName",
    ].forEach((field) => {
      if (keys[field] != null && typeof keys[field] !== "string") {
        pushError(errors, `keys.${field}`, "must be a string when provided");
      }
    });
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

module.exports = {
  validateConfigSchema,
};
