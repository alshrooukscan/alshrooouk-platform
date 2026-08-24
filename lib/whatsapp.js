import { phoneForWhatsApp } from "./formatPhone";

// Ops number that receives the internal "Scan" message. Move to Settings/admin config in a later sprint.
const OPS_WHATSAPP_NUMBER = "+201288871871";

function encode(text) {
  return encodeURIComponent(text).replace(/%0A/g, "%0A");
}

export function buildCustomerMessage({ patientName, portalUrl, username, password }) {
  const text =
    `Hi ${patientName}. \n` +
    `Thank you for Visiting Al Shroouk Scan\n` +
    `All you Scans/Reports will be sent directly to your number\n\n` +
    `View your results here: ${portalUrl}\n` +
    `Username: ${username}\n` +
    `Password: ${password}`;
  return text;
}

export function buildScanMessage({ branch, patientName, mobile, email, scanTypes, doctorName, doctorPhone, doctorPhone2, doctorEmail, clinicCode }) {
  const doctorPhoneLine = doctorPhone2 ? `${doctorPhone || ""} / ${doctorPhone2}` : doctorPhone || "";
  const text =
    `Branch: ${branch} \n` +
    `Paitent Info :\n` +
    `Name: ${patientName}\n` +
    `Phone: ${mobile}\n` +
    `Email: ${email || ""}\n` +
    `Scan: ${scanTypes}\n` +
    `Doctor Info :\n` +
    `Name: ${doctorName || ""}\n` +
    `Phone: ${doctorPhoneLine}\n` +
    `Email: ${doctorEmail || ""}\n` +
    `Clinic: ${clinicCode || ""}`;
  return text;
}

export function customerWhatsAppLink({ mobile, patientName, portalUrl, username, password }) {
  const text = buildCustomerMessage({ patientName, portalUrl, username, password });
  // WhatsApp's click-to-chat only works reliably with digits-only + country code -
  // no "+", no leading zero. Stored numbers vary in raw format, so always normalize here.
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

export function scanWhatsAppLink(payload) {
  const text = buildScanMessage(payload);
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(OPS_WHATSAPP_NUMBER)}&text=${encode(text)}`;
}

export function buildVendorReportMessage({ vendorName, description, completedDate }) {
  const text =
    `Hi ${vendorName}, \n` +
    `Your requested report has been completed by Al Shrooouk Scan & Lab.\n\n` +
    `Request: ${description}\n` +
    `Completed: ${completedDate}\n\n` +
    `Thank you.`;
  return text;
}

export function vendorWhatsAppLink({ mobile, vendorName, description, completedDate }) {
  const text = buildVendorReportMessage({ vendorName, description, completedDate });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

export function buildDoctorPortalMessage({ doctorName, portalUrl, username, password }) {
  const text =
    `Hi ${doctorName}, \n` +
    `Your Al Shrooouk Scan & Lab referral portal account is ready.\n\n` +
    `View your referred patients' results here: ${portalUrl}\n` +
    `Username: ${username}\n` +
    `Password: ${password}`;
  return text;
}

export function doctorPortalWhatsAppLink({ mobile, doctorName, portalUrl, username, password }) {
  const text = buildDoctorPortalMessage({ doctorName, portalUrl, username, password });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

export function buildEmployeePortalMessage({ employeeName, portalUrl, username, password }) {
  const text =
    `Hi ${employeeName}, \n` +
    `Your Al Shrooouk Scan & Lab staff portal account is ready.\n\n` +
    `Login here: ${portalUrl}\n` +
    `Username: ${username}\n` +
    `Password: ${password}`;
  return text;
}

export function employeePortalWhatsAppLink({ mobile, employeeName, portalUrl, username, password }) {
  const text = buildEmployeePortalMessage({ employeeName, portalUrl, username, password });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}
