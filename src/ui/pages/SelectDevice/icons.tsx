import { JSX } from "react";

export const TASKBAR_ICON: Record<string, JSX.Element> = {
  download: (
    <svg viewBox="0 0 304 384" className="size-5">
      <path fill="currentColor" d="M299 128L149 277L0 128h85V0h128v128h86zM0 320h299v43H0v-43z"></path>
    </svg>
  ),

  delete: (
    <svg viewBox="0 0 304 384" className="size-5">
      <path fill="currentColor" d="M21 341V85h256v256q0 18-12.5 30.5T235 384H64q-18 0-30.5-12.5T21 341zM299 21v43H0V21h75L96 0h107l21 21h75z"></path>
    </svg>
  ),

  update: (
    <svg viewBox="0 0 32 32" className="size-5" fill="currentColor">
      <path d="M21,24H11a2,2,0,0,0-2,2v2a2,2,0,0,0,2,2H21a2,2,0,0,0,2-2V26A2,2,0,0,0,21,24Z" />
      <path d="M28.707,14.293l-12-12a1,1,0,0,0-1.414,0l-12,12A1,1,0,0,0,4,16H9v4a2,2,0,0,0,2,2H21a2,2,0,0,0,2-2V16h5a1,1,0,0,0,.707-1.707Z" />
    </svg>
  ),

  close: (
    <svg className="size-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

// ─── Product Icons ────────────────────────────────────────────────────────────
export const PRODUCT_ICON: Record<Product, JSX.Element> = {
  iphone: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5" y="2" width="14" height="20" rx="3" />
      <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none" />
      <line x1="9" y1="5" x2="15" y2="5" strokeLinecap="round" />
    </svg>
  ),
  ipad: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="2" width="18" height="20" rx="3" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  watch: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="7" y="7" width="10" height="10" rx="3" />
      <path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7" />
      <path d="M9 17v2.5a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V17" />
    </svg>
  ),
  mac: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M7 21h10M12 17v4" />
    </svg>
  ),
  tv: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 19v2" />
    </svg>
  ),
  homepod: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 3C8.5 3 6 6 6 10c0 5 3 9 6 11 3-2 6-6 6-11 0-4-2.5-7-6-7z" />
    </svg>
  ),
  ipod: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <circle cx="12" cy="16" r="2.5" />
      <rect x="9" y="5" width="6" height="4" rx="1" />
    </svg>
  ),
  realitydevice: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 8s3-4 10-4 10 4 10 4v4s-3 4-10 4-10-4-10-4z" />
      <ellipse cx="8.5" cy="10" rx="3" ry="3.5" />
      <ellipse cx="15.5" cy="10" rx="3" ry="3.5" />
    </svg>
  ),
};