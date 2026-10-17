/** Standalone OAuth layout; palette, radii and spacing come from the existing frontend theme. */
export const oauthPageStyles = `
.vh-auth{margin:0;min-height:100svh;background:var(--bg-page);color:var(--text-primary);font:14px/1.6 'Inter Variable','Noto Sans SC','PingFang SC',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.vh-auth *{box-sizing:border-box}
.vh-auth button,.vh-auth input{font:inherit}
.vh-auth a{color:inherit;text-decoration:none}
.vh-auth svg{width:20px;height:20px;flex:none}
.vh-auth .topbar{max-width:1200px;margin:auto;padding:30px 40px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.vh-auth .brand{display:flex;align-items:center;gap:11px;font-size:23px;font-weight:750;letter-spacing:-.8px}
.vh-auth .brand-dot{width:7px;height:7px;border-radius:var(--r-pill);background:var(--gold);align-self:flex-start;margin-top:10px}
.vh-auth .top-label{font-size:12px;letter-spacing:.12em;color:var(--text-secondary);border-left:1px solid var(--border-strong);padding-left:18px;margin-left:8px;font-weight:400}
.vh-auth .secure-label{display:flex;gap:7px;align-items:center;color:var(--text-secondary);font-size:12px}
.vh-auth .secure-label svg{width:15px;height:15px;color:var(--ok)}
.vh-auth main{max-width:1060px;margin:28px auto 0;padding:0 32px 24px}
.vh-auth .auth-card{display:grid;grid-template-columns:.95fr 1.05fr;border:1px solid var(--border-subtle);border-radius:var(--r-panel);overflow:hidden;background:var(--bg-panel);box-shadow:0 20px 70px color-mix(in srgb,var(--brand) 6%,transparent),0 2px 6px color-mix(in srgb,var(--brand) 3%,transparent)}
.vh-auth .context{padding:38px;background:var(--bg-elevated);border-right:1px solid var(--border-subtle)}
.vh-auth .eyebrow{display:flex;align-items:center;gap:8px;color:var(--gold);font-size:11px;font-weight:650;letter-spacing:.16em;margin:0 0 14px}
.vh-auth .eyebrow::before{content:'';width:24px;height:1px;background:var(--gold)}
.vh-auth h1{font-size:33px;line-height:1.3;font-weight:650;letter-spacing:-1px;margin:0 0 14px}
.vh-auth .intro{font-size:13px;line-height:1.85;color:var(--text-secondary);margin:0;max-width:310px;overflow-wrap:anywhere}
.vh-auth .permission-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:30px 0 8px;padding-bottom:12px;border-bottom:1px solid var(--border-subtle)}
.vh-auth .permission-heading h2{margin:0;font-size:12px;font-weight:650;letter-spacing:.06em}
.vh-auth .permission-count{font-size:11px;color:var(--text-secondary)}
.vh-auth .permissions{list-style:none;margin:0;padding:0}
.vh-auth .permission{display:flex;align-items:flex-start;gap:12px;padding:12px 0}
.vh-auth .permission-icon{width:31px;height:31px;display:grid;place-items:center;background:var(--bg-panel);border:1px solid var(--border-subtle);border-radius:var(--r-btn);color:var(--text-secondary);flex:none;margin-top:1px}
.vh-auth .permission-icon svg{width:16px;height:16px}
.vh-auth .permission-copy{flex:1;min-width:0}
.vh-auth .permission-title{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;font-weight:600}
.vh-auth .permission-copy p{margin:3px 0 0;font-size:11px;line-height:1.65;color:var(--text-secondary)}
.vh-auth .badge{font-size:10px;line-height:1.6;font-weight:500;padding:1px 6px;border-radius:var(--r-pill);background:var(--brand-soft);color:var(--text-secondary);white-space:nowrap}
.vh-auth .badge.write{background:var(--gold-bg);color:var(--gold)}
.vh-auth .access-note{display:flex;align-items:flex-start;gap:8px;border-top:1px solid var(--border-subtle);padding-top:16px;margin:12px 0 0;font-size:11px;line-height:1.8;color:var(--text-secondary)}
.vh-auth .access-note svg{width:14px;height:14px;color:var(--gold);margin-top:3px}
.vh-auth .form-panel{padding:40px 44px;display:flex;flex-direction:column;justify-content:center}
.vh-auth .connection{display:flex;align-items:center;gap:13px;margin-bottom:24px}
.vh-auth .app-tile{height:44px;min-width:44px;padding:0 9px;display:grid;place-items:center;border:1px solid var(--border-subtle);border-radius:var(--r-card);font-size:16px;font-weight:700;letter-spacing:-1px;background:var(--bg-elevated);color:var(--text-primary)}
.vh-auth .app-tile.vibe{background:var(--brand);color:var(--bg-panel);border-color:var(--brand)}
.vh-auth .connection svg{width:17px;height:17px;color:var(--text-tertiary)}
.vh-auth .connection-name{margin-left:1px;font-size:11px;line-height:1.5;color:var(--text-secondary);overflow-wrap:anywhere;max-width:180px}
.vh-auth .connection-name strong{display:block;color:var(--text-primary);font-size:12px;font-weight:600}
.vh-auth h2.form-title{font-size:25px;line-height:1.4;letter-spacing:-.5px;margin:0 0 8px;font-weight:650}
.vh-auth .form-subtitle{margin:0 0 26px;font-size:12px;line-height:1.85;color:var(--text-secondary)}
.vh-auth .mobile-permissions{display:none}
.vh-auth .field{margin-bottom:18px}
.vh-auth .field-label{display:block;margin-bottom:8px;font-size:12px;font-weight:600}
.vh-auth .input-wrap{position:relative}
.vh-auth .input-wrap>.field-icon{position:absolute;left:14px;top:16px;color:var(--text-tertiary);width:16px;height:16px;pointer-events:none}
.vh-auth .field input{display:block;width:100%;height:48px;border:1px solid var(--border-strong);border-radius:var(--r-btn);padding:0 45px 0 42px;background:var(--bg-panel);color:var(--text-primary);font-size:13px;outline:none}
.vh-auth .field input::placeholder{color:var(--text-tertiary)}
.vh-auth .field input:focus{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
.vh-auth .field input[aria-invalid=true]{border-color:var(--danger)}
.vh-auth .eye{position:absolute;right:6px;top:6px;width:36px;height:36px;border:0;border-radius:var(--r-btn);background:transparent;color:var(--text-secondary);display:none;place-items:center;cursor:pointer}
.vh-auth .eye:hover{background:var(--bg-elevated)}
.vh-auth .eye svg{width:17px;height:17px}
.vh-auth .field-hint{margin:7px 0 0;font-size:11px;color:var(--text-secondary)}
.vh-auth .consent{display:flex;align-items:flex-start;gap:9px;margin:23px 0 20px;font-size:11px;line-height:1.9;color:var(--text-secondary);cursor:pointer}
.vh-auth .consent input{width:15px;height:15px;margin:3px 0 0;flex:none;accent-color:var(--brand)}
.vh-auth .consent strong{font-weight:600;color:var(--text-primary)}
.vh-auth .actions{display:grid;grid-template-columns:1fr 2fr;gap:10px}
.vh-auth .button{height:46px;border-radius:var(--r-btn);border:1px solid var(--border-strong);display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;font-size:13px;font-weight:600;background:var(--bg-panel);color:var(--text-secondary)}
.vh-auth .button:hover{background:var(--bg-elevated)}
.vh-auth .button.primary{background:var(--brand);color:var(--bg-panel);border-color:var(--brand);order:2}
.vh-auth .button.primary:hover{background:var(--brand-navy)}
.vh-auth .button.primary svg{width:16px;height:16px}
.vh-auth .button:disabled{opacity:.65;cursor:wait}
.vh-auth .button:focus-visible,.vh-auth .eye:focus-visible,.vh-auth a:focus-visible{outline:2px solid var(--brand);outline-offset:3px}
.vh-auth .after-form{margin:20px 0 0;text-align:center;color:var(--text-secondary);font-size:11px}
.vh-auth .after-form strong{font-weight:500;color:var(--text-primary)}
.vh-auth .error{display:flex;gap:9px;align-items:flex-start;background:color-mix(in srgb,var(--danger) 6%,var(--bg-panel));border:1px solid color-mix(in srgb,var(--danger) 25%,transparent);color:var(--danger);padding:11px 13px;border-radius:var(--r-btn);margin:0 0 18px;font-size:12px}
.vh-auth .error svg{height:16px;width:16px;margin-top:2px}
.vh-auth .footer{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:21px 4px 8px;color:var(--text-secondary);font-size:11px}
.vh-auth .footer span:last-child{display:flex;align-items:center;gap:6px}
.vh-auth .footer svg{height:13px;width:13px}
@media(min-width:900px) and (max-height:850px){.vh-auth .topbar{padding-top:20px;padding-bottom:20px}.vh-auth main{margin-top:8px}.vh-auth .context{padding:28px 34px}.vh-auth .form-panel{padding:30px 40px}.vh-auth .permission{padding:9px 0}.vh-auth .permission-heading{margin-top:22px}.vh-auth .footer{padding-top:15px}}
@media(max-width:760px){.vh-auth .topbar{padding:20px 22px}.vh-auth .brand{font-size:21px}.vh-auth .top-label{display:none}.vh-auth main{padding:0 16px 20px;margin-top:10px}.vh-auth .auth-card{grid-template-columns:1fr}.vh-auth .form-panel{order:-1;padding:28px 24px}.vh-auth .context{padding:26px 24px;border-right:0;border-top:1px solid var(--border-subtle)}.vh-auth h1{font-size:25px}.vh-auth h1 br{display:none}.vh-auth .intro{max-width:none}.vh-auth .context .eyebrow{margin-bottom:10px}.vh-auth .permission-heading{margin-top:20px}.vh-auth .permission{padding:10px 0}.vh-auth .connection{margin-bottom:20px}.vh-auth .footer{flex-direction:column;gap:6px;text-align:center}.vh-auth .form-subtitle{margin-bottom:22px}}
@media(max-width:760px){.vh-auth .mobile-permissions{display:flex;align-items:center;gap:7px;width:fit-content;margin-top:10px;color:var(--brand);text-decoration:underline;text-underline-offset:3px}.vh-auth .mobile-permissions svg{width:13px;height:13px}}
`;
