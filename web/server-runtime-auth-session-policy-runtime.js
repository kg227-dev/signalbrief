"use strict";

const {
  verifyAdminPassword,
  createAdminSession,
  clearAdminSessionByRequest,
  getAdminActor,
  isAdminAuthed,
  checkLoginRate,
} = require("./admin-auth");

function createAdminAuthSessionPolicy() {
  return {
    verifyAdminPassword,
    createAdminSession,
    clearAdminSessionByRequest,
    getAdminActor,
    isAdminAuthed,
    checkLoginRate,
  };
}

module.exports = {
  createAdminAuthSessionPolicy,
};
