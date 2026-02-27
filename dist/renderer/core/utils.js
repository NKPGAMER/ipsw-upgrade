import { data } from "../data.js";
function pushDownExistingNotifications(newNotification) {
    const allNotifications = document.querySelectorAll('.error-message, .success-message');
    const newNotifHeight = newNotification.offsetHeight + 10;
    allNotifications.forEach(notif => {
        if (notif !== newNotification) {
            const currentTop = parseInt(notif.style.top || '20');
            notif.style.transition = 'top 0.3s ease';
            notif.style.top = (currentTop + newNotifHeight) + 'px';
        }
    });
}
function updateNotificationPositions() {
    const notifications = document.querySelectorAll('.error-message, .success-message');
    let currentTop = 20;
    notifications.forEach(notif => {
        const element = notif;
        const oldTop = parseInt(element.style.top || '20');
        if (oldTop !== currentTop) {
            element.style.transition = 'top 0.3s ease';
            element.style.top = currentTop + 'px';
        }
        currentTop += element.offsetHeight + 10;
    });
}
export default {
    sleep: (timeout) => new Promise((resolve) => setTimeout(resolve, timeout)),
    getFileNameFromUrl: (url) => url.split("/").pop() ?? "Unknown",
    async findFile(fileName, firmwares) {
        const args = fileName.split('_');
        const restoreIndex = args.findIndex(a => a.startsWith("Restore"));
        if (args.length < 4 || restoreIndex === -1)
            return [];
        const targetName = args.slice(0, restoreIndex - 2).join('_');
        const buildIdMap = firmwares.map(fm => fm.buildid);
        return data.localFiles.filter(f => {
            const fArgs = f.name.split('_');
            const fRestoreIndex = fArgs.findIndex(i => i.startsWith("Restore"));
            if (fRestoreIndex === -1)
                return false;
            const fName = fArgs.slice(0, fRestoreIndex - 2).join('_');
            return fName === targetName &&
                buildIdMap.some(id => f.name.includes(id));
        });
    },
    showErrorMessage(message, timeout = 8000) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'message error-message';
        errorDiv.textContent = message;
        errorDiv.style.top = '20px';
        document.body.appendChild(errorDiv);
        pushDownExistingNotifications(errorDiv);
        setTimeout(() => {
            errorDiv.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
            errorDiv.style.transform = 'translateX(400px)';
            errorDiv.style.opacity = '0';
            setTimeout(() => {
                errorDiv.remove();
                updateNotificationPositions();
            }, 300);
        }, timeout);
    },
    showSuccessMessage(message, timeout = 4000) {
        const successDiv = document.createElement('div');
        successDiv.className = 'message success-message';
        successDiv.textContent = message;
        successDiv.style.top = '20px';
        document.body.appendChild(successDiv);
        pushDownExistingNotifications(successDiv);
        setTimeout(() => {
            successDiv.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
            successDiv.style.transform = 'translateX(400px)';
            successDiv.style.opacity = '0';
            setTimeout(() => {
                successDiv.remove();
                updateNotificationPositions();
            }, 300);
        }, timeout);
    },
    async checkMd5(filePath, firmware, options = {}) {
        const e = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showSuccessMessage('Đang xác minh. Hãy chờ đến khi quá trình này kết thúc');
        };
        try {
            document.addEventListener('click', e, true);
            const actualMd5 = await window.api.createMd5(filePath, { ...options, highWaterMark: 2 * 1024 * 1024 });
            return actualMd5 === firmware.md5sum;
        }
        catch (error) {
            console.error("Create Md5sum failed", error);
            return false;
        }
        finally {
            document.removeEventListener('click', e, true);
        }
    },
    formatBytes(bytes, decimals = 2) {
        if (bytes === 0)
            return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
    },
};
