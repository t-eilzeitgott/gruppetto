export const SUPPORT_URL = 'https://ko-fi.com/talfahrt';

export const SUPPORT_ENABLED = SUPPORT_URL.length > 0;

export const SUPPORT_EMBED = SUPPORT_ENABLED ? `${SUPPORT_URL}/?hidefeed=true&widget=true&embed=true&preview=true` : '';
