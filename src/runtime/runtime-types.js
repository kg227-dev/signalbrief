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
 * @property {any[]} [last_digest_items]
 * @property {any[]} [topics]
 */

module.exports = {};
