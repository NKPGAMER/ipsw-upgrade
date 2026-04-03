import { EventEmitter } from "events";
import isOnline from "is-online";

export class InternetService extends EventEmitter {
    private online = true;

    public start(interval: number = 5000) {
        setInterval(async () => {
            const status = await isOnline();

            if (status !== this.online) {
                this.online = status;
                this.emit(status ? "online" : "offline");
            } 
        }, interval);
    }

    public async isOnline() {
        return await isOnline();
    }
}