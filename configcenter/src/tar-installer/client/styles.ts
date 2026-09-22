/** Lifecycle-bound styles for the installer panel. */
import { injectStylesOnce } from '../../client/injectStyles.js'

const STYLE_TAG = 'configcenter/installer.css'

export const INSTALLER_CSS = `
.dti-root{height:100%;overflow:auto;background:#f6f7f9;color:var(--color-text,#172033);font-family:Inter,ui-sans-serif,system-ui,sans-serif}
.dti-shell{max-width:920px;margin:0 auto;padding:42px 30px 64px}
.dti-eyebrow{font-size:12px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:#2877e6;margin-bottom:10px}
.dti-title-row{display:flex;gap:18px;align-items:flex-start;justify-content:space-between}.dti-title{font-size:30px;line-height:1.18;margin:0 0 10px;font-weight:750}.dti-subtitle{margin:0 0 28px;color:#647087;line-height:1.6}
.dti-card{background:#fff;border:1px solid #dfe4ec;border-radius:16px;box-shadow:0 8px 28px rgba(26,39,64,.06);padding:24px}
.dti-drop{border:1.5px dashed #b8c3d5;border-radius:13px;padding:38px 24px;text-align:center;background:#fafcff;transition:.16s ease}.dti-drop[data-drag=true]{border-color:#2877e6;background:#f1f7ff;transform:translateY(-1px)}
.dti-drop-title{font-size:18px;font-weight:700;margin-bottom:8px}.dti-muted{color:#738096;font-size:13px;line-height:1.5}.dti-file{display:none}
.dti-button{appearance:none;border:0;border-radius:9px;padding:10px 16px;font:inherit;font-weight:650;cursor:pointer;background:#2877e6;color:#fff}.dti-button:hover{background:#1765cf}.dti-button:disabled{cursor:not-allowed;opacity:.55}.dti-button.secondary{background:#edf1f7;color:#344158}.dti-actions{display:flex;gap:10px;align-items:center;margin-top:22px;flex-wrap:wrap}
.dti-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:#e6eaf0;border:1px solid #e6eaf0;border-radius:12px;overflow:hidden;margin-top:20px}.dti-cell{background:#fff;padding:14px 16px;min-width:0}.dti-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#7b879a;margin-bottom:6px}.dti-value{font-weight:650;word-break:break-word}.dti-sha{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;font-weight:500}
.dti-badges{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}.dti-badge{padding:6px 9px;border-radius:999px;background:#eef6ff;color:#2167bd;font-size:12px;font-weight:650}.dti-badge.off{background:#f1f3f6;color:#7b8492}
.dti-check{display:flex;align-items:flex-start;gap:10px;margin-top:20px;padding:14px;border:1px solid #f0d798;background:#fffaf0;border-radius:10px}.dti-check input{margin-top:3px}.dti-alert{margin-top:18px;border-radius:10px;padding:13px 15px;background:#eef7f1;color:#24633c}.dti-alert.error{background:#fff1f1;color:#a33434}
.dti-output{margin-top:14px;background:#111827;color:#dbe4f3;border-radius:10px;padding:14px;white-space:pre-wrap;max-height:250px;overflow:auto;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}
.dti-installed{margin-top:18px}.dti-section-heading{display:flex;gap:16px;align-items:flex-start;justify-content:space-between}.dti-section-heading h2{font-size:18px;margin:0 0 5px}.dti-section-heading p{margin:0;color:#738096;font-size:13px;line-height:1.5}.dti-search{box-sizing:border-box;width:100%;margin-top:18px;border:1px solid #d7dee9;border-radius:9px;padding:10px 12px;background:#fff;color:inherit;font:inherit}.dti-search:focus{outline:2px solid #b8d5ff;outline-offset:1px;border-color:#2877e6}.dti-list-state{padding:22px 2px}.dti-package-list{max-height:360px;overflow:auto;margin-top:12px;border:1px solid #e4e9f0;border-radius:11px}.dti-package{display:flex;gap:16px;align-items:center;justify-content:space-between;padding:13px 14px;border-bottom:1px solid #e9edf3}.dti-package:last-child{border-bottom:0}.dti-package-main{display:flex;min-width:0;flex:1;flex-direction:column;gap:4px}.dti-package-main strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dti-package-main span{color:#738096;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dti-package-meta{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap;color:#657188;font-size:12px}.dti-package-kind{padding:4px 7px;border-radius:999px;background:#eaf4ff;color:#2167bd;font-weight:650}.dti-package-kind.plain{background:#f0f2f5;color:#667085}
.dti-text-button{appearance:none;border:0;background:transparent;color:#b13a3a;font:inherit;font-size:12px;font-weight:650;cursor:pointer;padding:4px}.dti-text-button:disabled{opacity:.5;cursor:not-allowed}
.dti-spinner{display:inline-block;width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:dti-spin .7s linear infinite;vertical-align:-2px;margin-right:7px}@keyframes dti-spin{to{transform:rotate(360deg)}}
@media(max-width:640px){.dti-shell{padding:24px 16px 44px}.dti-title{font-size:25px}.dti-grid{grid-template-columns:1fr}.dti-card{padding:17px}.dti-title-row,.dti-section-heading,.dti-package{align-items:flex-start;flex-direction:column}.dti-package-meta{justify-content:flex-start}}
`

export function injectStyles(): () => void {
  return injectStylesOnce(STYLE_TAG, INSTALLER_CSS)
}
