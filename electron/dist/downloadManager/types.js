"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPC = void 0;
// IPC channel names (used by both main & renderer)
exports.IPC = {
    EVENT: "dm:event",
    ADD: "dm:add",
    PAUSE: "dm:pause",
    RESUME: "dm:resume",
    CANCEL: "dm:cancel",
    PAUSE_ALL: "dm:pause-all",
    RESUME_ALL: "dm:resume-all",
    GET_ALL: "dm:get-all",
    UPDATE_QUEUE: "dm:update-queue",
};
