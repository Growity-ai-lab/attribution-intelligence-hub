// Browser-storage helpers for keeping the user signed in across reloads.
// Storage can be unavailable (private mode, blocked site data) and then
// throws, so every access is guarded and the app simply behaves as signed out.

const TOKEN_KEY = 'th_token' // localStorage: survives reloads and new tabs until the JWT expires
const WORKSPACE_KEY = 'th_workspace' // sessionStorage: per tab, survives reloads
const TAB_KEY = 'th_tab'

function read(store, key) {
  try { return window[store].getItem(key) } catch { return null }
}
function write(store, key, value) {
  try {
    if (value == null) window[store].removeItem(key)
    else window[store].setItem(key, value)
  } catch { /* storage unavailable: nothing to persist */ }
}

export const savedToken = () => read('localStorage', TOKEN_KEY)
export const saveToken = token => write('localStorage', TOKEN_KEY, token)

/** @returns {{clientId: number, campaignId: number} | null} */
export function savedWorkspace() {
  try {
    const v = JSON.parse(read('sessionStorage', WORKSPACE_KEY))
    return v && Number.isInteger(v.clientId) && Number.isInteger(v.campaignId) ? v : null
  } catch { return null }
}
export const saveWorkspace = ws => write('sessionStorage', WORKSPACE_KEY,
  ws ? JSON.stringify({ clientId: ws.client.id, campaignId: ws.campaign.id }) : null)

export const savedTab = () => read('sessionStorage', TAB_KEY)
export const saveTab = tab => write('sessionStorage', TAB_KEY, tab)

/** Forget everything tied to the signed-in user. */
export function clearSession() {
  saveToken(null)
  saveWorkspace(null)
  saveTab(null)
}
