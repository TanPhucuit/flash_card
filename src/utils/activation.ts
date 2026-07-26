const ACTIVATION_STORAGE_KEY = "local-english-activation-key";
const SECRET_SALT = "LocalEnglish_ToolBoxGiaRe_Lifetime_2026#pL4";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function formatCode(prefix: string, hex: string) {
  return `${prefix}-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

export async function getMachineCode(): Promise<string> {
  const parts = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
  };
  return formatCode("HWID", await sha256Hex(JSON.stringify(parts)));
}

export async function generateActivationKey(machineCode: string): Promise<string> {
  return formatCode("KEY", await sha256Hex(`${machineCode.trim().toUpperCase()}|${SECRET_SALT}`));
}

export async function isActivated(): Promise<boolean> {
  const savedKey = localStorage.getItem(ACTIVATION_STORAGE_KEY)?.trim().toUpperCase();
  if (!savedKey) return false;
  const machineCode = await getMachineCode();
  return savedKey === await generateActivationKey(machineCode);
}

export function saveActivationKey(key: string) {
  localStorage.setItem(ACTIVATION_STORAGE_KEY, key.trim().toUpperCase());
}
