"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InternetService = void 0;
const events_1 = require("events");
const is_online_1 = __importDefault(require("is-online"));
class InternetService extends events_1.EventEmitter {
    online = true;
    start(interval = 5000) {
        setInterval(async () => {
            const status = await (0, is_online_1.default)();
            if (status !== this.online) {
                this.online = status;
                this.emit(status ? "online" : "offline");
            }
        }, interval);
    }
    async isOnline() {
        return await (0, is_online_1.default)();
    }
}
exports.InternetService = InternetService;
