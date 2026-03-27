"use strict";

/**
 * @typedef {"active"|"paused"|"unsubscribed"} UserStatus
 */

/**
 * @typedef {Object} UserRecord
 * @property {string} chatId
 * @property {string|null} email
 * @property {UserStatus} status
 * @property {string|null} token
 * @property {number} digests_received
 * @property {{ delivery_time?: string, email_enabled?: boolean, depth?: string, days_of_week?: number[], [key: string]: any }} preferences
 * @property {any} [reengagement_state]
 * @property {any[]} [last_digest_items]
 * @property {any[]} [topics]
 */

/**
 * @typedef {Object} ReplyState
 * @property {Map<string, boolean|string>} awaitingEmail
 * @property {Set<string>} digestInflight
 * @property {Map<string, any>} pendingLinkVerifications
 */

/**
 * @typedef {Object} PendingVerification
 * @property {string} email
 * @property {string} code
 * @property {number} expiresAt
 * @property {number} attempts
 * @property {number} resend_after_ts
 */

/**
 * @typedef {Object} TransportJsonResponse
 * @property {"json"} kind
 * @property {number|null|undefined} status
 * @property {Record<string, any>} body
 */

/**
 * @typedef {Object} TransportTextResponse
 * @property {"text"} kind
 * @property {number|null|undefined} status
 * @property {string} body
 */

/**
 * @typedef {TransportJsonResponse|TransportTextResponse} TransportResponse
 */

/**
 * @typedef {Object} OnboardingDeps
 * @property {ReplyState|(() => ReplyState)} state
 * @property {number} linkVerifyTtlMs
 * @property {(chatId: string, text: string, extra?: Object) => Promise<TransportResponse|unknown>} sendMessage
 * @property {(email: string, code: string) => Promise<unknown>} sendVerificationEmail
 * @property {(email: string) => UserRecord|null} findUserByEmail
 * @property {(existing: UserRecord, chatId: string) => UserRecord} relinkUserToChat
 * @property {(prefs: Object) => string} formatDeliveryTime
 */

module.exports = {};
