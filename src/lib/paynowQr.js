// PayNow QR payload (spec: parent-portal 6.2). Pure functions; the only import is
// the QR-drawing package, used by drawPayNowQrDataUrl. EMVCo merchant-presented
// QR as used by SGQR / PayNow.
import qrcode from "qrcode-generator";

export function crc16ccitt(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

const tlv = (id, value) => id + String(value.length).padStart(2, "0") + value;

export function parsePayNowProxy(raw) {
  if (!raw) return null;
  const compact = String(raw).trim().replace(/[\s-]/g, "").toUpperCase();
  const m = compact.match(/^(?:\+?65)?([89]\d{7})$/);
  if (m) return { type: "0", value: "+65" + m[1] };
  if (/^(\d{8}[A-Z]|\d{9}[A-Z]|[TSR]\d{2}[A-Z]{2}\d{4}[A-Z])([A-Z0-9]{3})?$/.test(compact)) {
    return { type: "2", value: compact };
  }
  return null;
}

export function sanitizeReference(ref) {
  return String(ref ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 25);
}

// Returns the payload string, or null when no valid QR can be made.
export function buildPayNowPayload({ proxy, amount, reference }) {
  const p = parsePayNowProxy(proxy);
  const cents = Math.round(Number(amount) * 100);
  if (!p || !Number.isFinite(cents) || cents <= 0 || cents > 99999999) return null;
  const amt = (cents / 100).toFixed(2);
  const ref = sanitizeReference(reference);
  const mai = tlv("00", "SG.PAYNOW") + tlv("01", p.type) + tlv("02", p.value) + tlv("03", "0");
  let s = tlv("00", "01") + tlv("01", "12") + tlv("26", mai) + tlv("52", "0000") +
          tlv("53", "702") + tlv("54", amt) + tlv("58", "SG") + tlv("59", "NA") + tlv("60", "Singapore");
  if (ref) s += tlv("62", tlv("01", ref));
  s += "6304";
  return s + crc16ccitt(s);
}


const PX = 8; // pixels per module
const QUIET = 4; // modules of white border

// Renders the payload to an off-screen canvas (navy modules on white) and returns
// a PNG data URL, or null when it cannot be drawn.
export function drawPayNowQrDataUrl(payload) {
  if (!payload) return null;
  try {
    const qr = qrcode(0, "M");
    qr.addData(payload);
    qr.make();
    const n = qr.getModuleCount();
    const size = (n + QUIET * 2) * PX;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#1b2d4f";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + QUIET) * PX, (r + QUIET) * PX, PX, PX);
      }
    }
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

// "9123 4567" for a mobile, the UEN as is, or the raw text when unparseable.
export function displayPayNowNumber(raw) {
  const p = parsePayNowProxy(raw);
  if (!p) return String(raw ?? "").trim();
  if (p.type === "0") return `${p.value.slice(3, 7)} ${p.value.slice(7)}`;
  return p.value;
}
