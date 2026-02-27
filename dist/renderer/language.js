let dict = {};
let currentLang = null;
async function loadLanguage(lang) {
    if (currentLang === lang)
        return;
    try {
        const res = await fetch(`./locales/${lang}.json`);
        if (!res.ok)
            throw new Error(`Failed to load language: ${lang}`);
        dict = await res.json();
        currentLang = lang;
    }
    catch (error) {
        console.error(`Error loading language ${lang}:`, error);
        throw error;
    }
}
function applyLang() {
    // Sử dụng querySelectorAll một lần và cache kết quả
    const elements = document.querySelectorAll('[data-t]');
    // Sử dụng DocumentFragment để giảm reflow (nếu cần thiết cho DOM lớn)
    elements.forEach(el => {
        if (!(el instanceof HTMLElement))
            return;
        const key = el.dataset.t;
        if (!key)
            return;
        const translation = dict[key] || key;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            el.placeholder = translation;
        }
        else {
            // Chỉ cập nhật nếu giá trị thay đổi để tránh reflow không cần thiết
            if (el.textContent !== translation) {
                el.textContent = translation;
            }
        }
    });
}
const t = (key) => dict[key] ?? key;
async function changeLanguage(lang) {
    await loadLanguage(lang);
    applyLang();
}
export { t, changeLanguage };
