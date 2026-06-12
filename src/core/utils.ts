import { t } from "i18next";

function pushDownExistingNotifications(newNotification: HTMLElement) {
  const allNotifications = document.querySelectorAll('.error-message, .success-message');
  const newNotifHeight = newNotification.offsetHeight + 10;

  allNotifications.forEach(notif => {
    if (notif !== newNotification) {
      const currentTop = parseInt((notif as HTMLElement).style.top || '20');
      (notif as HTMLElement).style.transition = 'top 0.3s ease';
      (notif as HTMLElement).style.top = (currentTop + newNotifHeight) + 'px';
    }
  });
}

function updateNotificationPositions() {
  const notifications = document.querySelectorAll('.error-message, .success-message');
  let currentTop = 20;

  notifications.forEach(notif => {
    const element = notif as HTMLElement;
    const oldTop = parseInt(element.style.top || '20');

    if (oldTop !== currentTop) {
      element.style.transition = 'top 0.3s ease';
      element.style.top = currentTop + 'px';
    }

    currentTop += element.offsetHeight + 10;
  });
}

interface QueueItem {
  message: string
  options: ConfirmOptions
  resolve: (v: boolean) => void
}

class ConfirmService {

  private queue: QueueItem[] = []
  private active = false
  private root: HTMLElement

  constructor() {
    let root = document.getElementById("confirm-root")

    if (!root) {
      root = document.createElement("div")
      root.id = "confirm-root"
      document.body.appendChild(root)
    }

    this.root = root
  }

  confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {

    return new Promise(resolve => {

      this.queue.push({
        message,
        options,
        resolve
      })

      if (!this.active) {
        this.next()
      }

    })

  }

  closeAll() {
    return new Promise((resolve, reject) => {
      try {
        for (const item of this.queue) {
      item.resolve(false)
    }
    this.queue = []

    this.active = false

    // Close the currently open dialog (if any)
    const wrap = this.root.querySelector(".confirm-wrap") as HTMLElement
    if (wrap) {
      const backdrop = wrap.querySelector(".confirm-backdrop") as HTMLElement
      const dialog = wrap.querySelector(".confirm-dialog") as HTMLElement

      backdrop?.classList.replace("backdrop-in", "backdrop-out")
      dialog?.classList.replace("dialog-in", "dialog-out")

      setTimeout(() => {
        wrap.remove()
      }, 180)
    } else {
      this.active = false
    }

    resolve(true)
      } catch {
reject(false);
      }
    })
  }

  private next() {

    const item = this.queue.shift()

    if (!item) {
      this.active = false
      return
    }

    this.active = true
    this.show(item)

  }

  private show(item: QueueItem) {

    const {
      title = "",
      confirmText = "Ok",
      cancelText = "Cancel",
      variant = "default"
    } = item.options

    const wrap = document.createElement("div")
    wrap.className = "confirm-wrap"

    wrap.innerHTML = `
      <div class="confirm-backdrop backdrop-in"></div>

      <div class="confirm-dialog dialog-in confirm-${variant}" tabindex="0">

        <div class="confirm-accent"></div>

        <div class="confirm-body">

          <div class="confirm-header">

            <div class="confirm-icon">
              ${this.icon(variant)}
            </div>

            <div>
              ${title ? `<div class="confirm-title">${title}</div>` : ""}
              <div class="confirm-content">
                ${this.renderMarkdown(item.message)}
              </div>
            </div>

          </div>

          <div class="confirm-divider"></div>

          <div class="confirm-actions">
            <button class="confirm-btn confirm-btn-cancel">
              ${cancelText}
            </button>

            <button class="confirm-btn confirm-btn-confirm">
              ${confirmText}
            </button>
          </div>

        </div>
      </div>
    `

    this.root.appendChild(wrap)

    const backdrop = wrap.querySelector(".confirm-backdrop") as HTMLElement
    const dialog = wrap.querySelector(".confirm-dialog") as HTMLElement
    const btnCancel = wrap.querySelector(".confirm-btn-cancel") as HTMLButtonElement
    const btnConfirm = wrap.querySelector(".confirm-btn-confirm") as HTMLButtonElement

    dialog.focus()

    const close = (result: boolean) => {

      backdrop.classList.replace("backdrop-in", "backdrop-out")
      dialog.classList.replace("dialog-in", "dialog-out")

      setTimeout(() => {

        wrap.remove()
        item.resolve(result)
        this.next()

      }, 180)

    }

    btnConfirm.onclick = () => close(true)
    btnCancel.onclick = () => close(false)
    backdrop.onclick = () => close(false)

    wrap.addEventListener("keydown", e => {
      if (e.key === "Escape") close(false)
      if (e.key === "Enter") close(true)
    })

  }

  private icon(variant: ConfirmVariant) {

    const icons = {

      default: `
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
      `,

      danger: `
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2">
        <path d="M12 9v4m0 4h.01"/>
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      </svg>
      `,

      warning: `
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 8v4m0 4h.01"/>
      </svg>
      `,

      info: `
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 16v-4m0-4h.01"/>
      </svg>
      `

    }

    return icons[variant] || icons.default

  }

  private css = `
  .md-body { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 15px; line-height: 1.7; color: #cdd6f4;}
  .md-h1 { font-size: 1.75em; font-weight: 700; color: #cba6f7; margin: 1.2em 0 0.5em; border-bottom: 2px solid #313244; padding-bottom: 0.3em; }
  .md-h2 { font-size: 1.4em; font-weight: 600; color: #89b4fa; margin: 1em 0 0.4em; border-bottom: 1px solid #313244; padding-bottom: 0.2em; }
  .md-h3 { font-size: 1.15em; font-weight: 600; color: #94e2d5; margin: 0.9em 0 0.3em; }
  .md-hr { border: none; border-top: 1px solid #313244; margin: 1.2em 0; }
  .md-ul { list-style: none; padding: 0; margin: 0.5em 0; }
  .md-ol { padding-left: 1.5em; margin: 0.5em 0; color: #cdd6f4; }
  .md-li { display: flex; align-items: flex-start; gap: 0.5em; padding: 0.2em 0; }
  .md-li-bullet { color: #cba6f7; font-size: 0.85em; margin-top: 0.3em; flex-shrink: 0; }
  .md-ol-li { padding: 0.2em 0; }
  .md-blockquote { border-left: 4px solid #cba6f7; background: #181825; margin: 0.8em 0; padding: 0.6em 1em; border-radius: 0 6px 6px 0; color: #a6adc8; font-style: italic; }
  .md-code-block { background: #11111b; color: #cdd6f4; font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 0.88em; padding: 1em 1.2em; border-radius: 8px; margin: 0.8em 0; overflow-x: auto; white-space: pre; border: 1px solid #313244; }
  .md-code-lang { font-size: 0.75em; color: #89b4fa; margin-bottom: 0.5em; text-transform: uppercase; letter-spacing: 0.05em; }
  .md-p { margin: 0.5em 0; color: #cdd6f4; }
  .md-gap { height: 6px; }
  .md-table { width: 100%; border-collapse: collapse; margin: 0.8em 0; font-size: 0.92em; }
  .md-table th { background: #181825; font-weight: 600; text-align: left; padding: 0.5em 0.9em; border: 1px solid #313244; color: #89b4fa; }
  .md-table td { padding: 0.45em 0.9em; border: 1px solid #313244; color: #cdd6f4; }
  .md-table tr:nth-child(even) td { background: #181825; }
  .md-img { max-width: 100%; border-radius: 6px; margin: 0.5em 0; display: block; }
  code { background: #313244; color: #f38ba8; font-family: 'Cascadia Code', monospace; font-size: 0.88em; padding: 0.1em 0.4em; border-radius: 4px; }
  strong { font-weight: 700; color: #f9e2af; }
  em { font-style: italic; color: #a6e3a1; }
  a { color: #89b4fa; text-decoration: underline; text-underline-offset: 2px; }
  a:hover { color: #b4d0fa; }
  del { color: #585b70; text-decoration: line-through; }
  mark { background: #f9e2af22; color: #f9e2af; padding: 0 0.2em; border-radius: 2px; border: 1px solid #f9e2af44; }
`;

  private inline(text: string): string {
    return text
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img class="md-img" src="$2" alt="$1">')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      .replace(/==(.+?)==/g, '<mark>$1</mark>')
      .replace(/_([\w\s]+)_/g, '<em>$1</em>');
  }

  private renderMarkdown(md: string): string {
    const lines = md.split("\n");
    const html: string[] = [];
    let i = 0;
    let olBuffer: string[] = [];
    let ulBuffer: string[] = [];

    const flushUl = () => {
      if (ulBuffer.length) {
        html.push(`<ul class="md-ul">${ulBuffer.join("")}</ul>`);
        ulBuffer = [];
      }
    };
    const flushOl = () => {
      if (olBuffer.length) {
        html.push(`<ol class="md-ol">${olBuffer.join("")}</ol>`);
        olBuffer = [];
      }
    };
    const flush = () => { flushUl(); flushOl(); };

    while (i < lines.length) {
      const line = lines[i];

      // Fenced code block
      const fenceMatch = line.match(/^```(\w*)/);
      if (fenceMatch) {
        flush();
        const lang = fenceMatch[1];
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith("```")) {
          codeLines.push(lines[i].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
          i++;
        }
        const langLabel = lang ? `<div class="md-code-lang">${lang}</div>` : "";
        html.push(`<div class="md-code-block">${langLabel}${codeLines.join("\n")}</div>`);
        i++;
        continue;
      }

      // Headings
      const h = line.match(/^(#{1,3})\s+(.+)/);
      if (h) {
        flush();
        const level = h[1].length;
        html.push(`<div class="md-h${level}">${this.inline(h[2])}</div>`);
        i++; continue;
      }

      // HR
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
        flush();
        html.push(`<hr class="md-hr">`);
        i++; continue;
      }

      // Blockquote
      const bq = line.match(/^>\s*(.*)/);
      if (bq) {
        flush();
        html.push(`<div class="md-blockquote">${this.inline(bq[1])}</div>`);
        i++; continue;
      }

      // Table
      if (line.includes("|") && lines[i + 1]?.match(/^\|?[\s\-|:]+\|?$/)) {
        flush();
        const headers = line.split("|").map(c => c.trim()).filter(Boolean);
        const tableHtml = [`<table class="md-table"><thead><tr>${headers.map(h => `<th>${this.inline(h)}</th>`).join("")}</tr></thead><tbody>`];
        i += 2;
        while (i < lines.length && lines[i].includes("|")) {
          const cells = lines[i].split("|").map(c => c.trim()).filter(Boolean);
          tableHtml.push(`<tr>${cells.map(c => `<td>${this.inline(c)}</td>`).join("")}</tr>`);
          i++;
        }
        tableHtml.push("</tbody></table>");
        html.push(tableHtml.join(""));
        continue;
      }

      // Unordered list
      const ul = line.match(/^[-*+]\s+(.+)/);
      if (ul) {
        flushOl();
        ulBuffer.push(`<li class="md-li"><span class="md-li-bullet">▶</span><span>${this.inline(ul[1])}</span></li>`);
        i++; continue;
      }

      // Ordered list
      const ol = line.match(/^\d+\.\s+(.+)/);
      if (ol) {
        flushUl();
        olBuffer.push(`<li class="md-ol-li">${this.inline(ol[1])}</li>`);
        i++; continue;
      }

      // Blank line
      if (!line.trim()) {
        flush();
        html.push(`<div class="md-gap"></div>`);
        i++; continue;
      }

      // Paragraph
      flush();
      html.push(`<p class="md-p">${this.inline(line)}</p>`);
      i++;
    }

    flush();
    return `<style>${this.css}</style><div class="md-body">${html.join("")}</div>`;
  }
}

const confirmService = new ConfirmService()

export default {
  sleep: (timeout: number) => new Promise((resolve) => setTimeout(resolve, timeout)),

  showErrorMessage(message: string, timeout = 8000) {
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

  showSuccessMessage(message: string | { id: any }, timeout = 4000) {
    const successDiv = document.createElement('div');
    successDiv.className = 'message success-message';
    successDiv.textContent = typeof message === 'string' ? message : t(message.id);

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

  formatBytes(bytes: number, decimals: number = 2): { value: string, unit: string } {
    if (bytes === 0) return {
      value: "0",
      unit: "Bytes"
    };

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return {
      value: parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)).toString(),
      unit: sizes[i]
    };
  },

  customConfirm: (message: string, options?: ConfirmOptions) => confirmService.confirm(message, options),

  closeAllConfirm: async () => await confirmService.closeAll()
}