"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_store_1 = __importDefault(require("electron-store"));
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const store = new electron_store_1.default({
    name: 'ipsw-link'
});
class IpswLink {
    data = new Map();
    constructor() {
        this.loadData();
    }
    loadData() {
        try {
            const storeData = store.get('ipsw-link');
            if (Array.isArray(storeData)) {
                this.data = new Map(storeData);
            }
        }
        catch (error) {
            console.error('Error loading data from store:', error);
            this.data = new Map();
        }
    }
    save() {
        try {
            store.set('ipsw-link', Array.from(this.data.entries()));
        }
        catch (error) {
            console.error('Error saving data to store:', error);
        }
    }
    add(deviceName, fromPath, toPath) {
        const links = this.data.get(deviceName) || [];
        const existingLink = links.find(link => link.fromPath === fromPath || link.toPath === toPath);
        if (!existingLink) {
            links.push({ fromPath, toPath });
            this.data.set(deviceName, links);
            this.save();
        }
    }
    removeLink(deviceName, linkPath) {
        const links = this.data.get(deviceName);
        if (!links) {
            return false;
        }
        const filteredLinks = links.filter(link => link.fromPath !== linkPath && link.toPath !== linkPath);
        if (filteredLinks.length === links.length) {
            return false;
        }
        if (filteredLinks.length === 0) {
            this.data.delete(deviceName);
        }
        else {
            this.data.set(deviceName, filteredLinks);
        }
        this.save();
        return true;
    }
    getLinks(deviceName) {
        return this.data.get(deviceName) || [];
    }
    getAllDevices() {
        return Array.from(this.data.keys());
    }
    async createLink(fromPath, toPath, deviceName) {
        try {
            if (!deviceName || deviceName.trim() === '') {
                return { success: false, error: 'Device name is required' };
            }
            if (!(0, fs_1.existsSync)(fromPath)) {
                return { success: false, error: `Source file does not exist: ${fromPath}` };
            }
            if ((0, fs_1.existsSync)(toPath)) {
                return { success: false, error: `Destination already exists: ${toPath}` };
            }
            const toDir = path_1.default.dirname(toPath);
            if (!(0, fs_1.existsSync)(toDir)) {
                await fs_1.promises.mkdir(toDir, { recursive: true });
            }
            await fs_1.promises.link(fromPath, toPath);
            if ((0, fs_1.existsSync)(toPath)) {
                this.add(deviceName, fromPath, toPath);
                return { success: true };
            }
            else {
                return { success: false, error: 'Failed to create hard link' };
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, error: `Failed to create link: ${errorMessage}` };
        }
    }
    async cleanupBrokenLinks() {
        let cleanedCount = 0;
        for (const [deviceName, links] of this.data.entries()) {
            const validLinks = [];
            for (const link of links) {
                const fromExists = (0, fs_1.existsSync)(link.fromPath);
                const toExists = (0, fs_1.existsSync)(link.toPath);
                if (fromExists && toExists) {
                    validLinks.push(link);
                }
                else {
                    cleanedCount++;
                    if (toExists) {
                        try {
                            await fs_1.promises.unlink(link.toPath);
                        }
                        catch (error) {
                            console.error(`Failed to cleanup ${link.toPath}:`, error);
                        }
                    }
                }
            }
            if (validLinks.length === 0) {
                this.data.delete(deviceName);
            }
            else if (validLinks.length !== links.length) {
                this.data.set(deviceName, validLinks);
            }
        }
        if (cleanedCount > 0) {
            this.save();
        }
        return cleanedCount;
    }
}
exports.default = new IpswLink();
